import { EventEmitter } from 'events';
import YahooFinance from 'yahoo-finance2';
import type { IMarketDataProvider } from '../types.js';
import type { StockQuote, VolumeAlert } from '../../types.js';
import type { YahooOptionsDataProvider } from './yahooOptionsData.js';
import { log } from '../../utils/logger.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const POLL_INTERVAL = 5000; // 5 seconds
const PERFORMANCE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const HISTORICAL_STAGGER_MS = 150; // Delay between historical requests
const VOLUME_HISTORY_LENGTH = 20;
const VOLUME_ALERT_THRESHOLD = 2;

interface PerformanceData {
  change1m: number | null;
  change3m: number | null;
  change6m: number | null;
  changeYtd: number | null;
  change1y: number | null;
  change2y: number | null;
  change3y: number | null;
  change5y: number | null;
  changeMax: number | null;
  realizedVol: number | null;
}

interface AnalyticsData {
  suppressionScore: number | null;
  relativeStrength: number | null;
  momentum: number | null;
  beta: number | null;
}

// Yahoo uses dashes where IBKR/themes use dots (e.g. BF.B → BF-B)
function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-');
}

function fromYahooSymbol(yahooSymbol: string): string {
  // Reverse: BF-B → BF.B — but only for known patterns (single letter after dash)
  return yahooSymbol.replace(/-([A-Z])$/, '.$1');
}

function computePerformance(
  bars: Array<{ date: Date; close: number }>,
  currentPrice: number,
): PerformanceData {
  if (bars.length === 0) {
    return {
      change1m: null, change3m: null, change6m: null, changeYtd: null,
      change1y: null, change2y: null, change3y: null, change5y: null, changeMax: null,
      realizedVol: null,
    };
  }

  const now = new Date();
  const pctChange = (oldPrice: number) =>
    parseFloat(((currentPrice - oldPrice) / oldPrice * 100).toFixed(2));

  // Find the bar with date closest to (but not after) the target date
  const findClosestBar = (targetDate: Date) => {
    let closest = bars[0];
    for (const bar of bars) {
      if (bar.date <= targetDate) {
        closest = bar;
      } else {
        break;
      }
    }
    return closest;
  };

  const d1m = new Date(now); d1m.setMonth(d1m.getMonth() - 1);
  const d3m = new Date(now); d3m.setMonth(d3m.getMonth() - 3);
  const d6m = new Date(now); d6m.setMonth(d6m.getMonth() - 6);
  const dYtd = new Date(now.getFullYear(), 0, 1);
  const d1y = new Date(now); d1y.setFullYear(d1y.getFullYear() - 1);
  const d2y = new Date(now); d2y.setFullYear(d2y.getFullYear() - 2);
  const d3y = new Date(now); d3y.setFullYear(d3y.getFullYear() - 3);
  const d5y = new Date(now); d5y.setFullYear(d5y.getFullYear() - 5);

  const bar1m = findClosestBar(d1m);
  const bar3m = findClosestBar(d3m);
  const bar6m = findClosestBar(d6m);
  const barYtd = findClosestBar(dYtd);
  const bar1y = findClosestBar(d1y);
  const bar2y = findClosestBar(d2y);
  const bar3y = findClosestBar(d3y);
  const bar5y = findClosestBar(d5y);

  // "MAX" uses the oldest bar available
  const barMax = bars[0];

  // Only report period change if we have data going back far enough
  const oldestDate = bars[0].date;
  const hasRange = (target: Date) => oldestDate <= target;

  return {
    change1m: bar1m ? pctChange(bar1m.close) : null,
    change3m: bar3m ? pctChange(bar3m.close) : null,
    change6m: bar6m ? pctChange(bar6m.close) : null,
    changeYtd: barYtd ? pctChange(barYtd.close) : null,
    change1y: hasRange(d1y) ? pctChange(bar1y.close) : null,
    change2y: hasRange(d2y) ? pctChange(bar2y.close) : null,
    change3y: hasRange(d3y) ? pctChange(bar3y.close) : null,
    change5y: hasRange(d5y) ? pctChange(bar5y.close) : null,
    changeMax: barMax ? pctChange(barMax.close) : null,
    realizedVol: null, // Computed separately from daily bars
  };
}

/** Compute daily log returns from an array of bars */
function computeLogReturns(bars: Array<{ date: Date; close: number }>): number[] {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i - 1].close > 0 && bars[i].close > 0) {
      returns.push(Math.log(bars[i].close / bars[i - 1].close));
    }
  }
  return returns;
}

/** Compute covariance between two arrays of equal length */
function covariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - meanX) * (y[i] - meanY);
  }
  return cov / (n - 1);
}

/** Compute variance of an array */
function variance(x: number[]): number {
  if (x.length < 2) return 0;
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  let v = 0;
  for (const val of x) {
    v += (val - mean) ** 2;
  }
  return v / (x.length - 1);
}

export class YahooMarketDataProvider extends EventEmitter implements IMarketDataProvider {
  private subscribedSymbols: Set<string> = new Set();
  private quotes: Map<string, Partial<StockQuote>> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private performanceCache: Map<string, { data: PerformanceData; timestamp: number }> = new Map();
  private analyticsCache: Map<string, AnalyticsData> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private isFetching = false;
  private optionsProvider: YahooOptionsDataProvider | null = null;

  // SPY reference data — fetched once and cached
  private spyDailyBars: Array<{ date: Date; close: number }> | null = null;
  private spyPerf: PerformanceData | null = null;
  private spyFetchTimestamp = 0;

  setOptionsProvider(provider: YahooOptionsDataProvider) {
    this.optionsProvider = provider;
  }

  subscribe(symbols: string[]) {
    let added = false;
    const newSymbols: string[] = [];
    for (const symbol of symbols) {
      if (!this.subscribedSymbols.has(symbol)) {
        this.subscribedSymbols.add(symbol);
        newSymbols.push(symbol);
        added = true;
      }
    }
    if (added) {
      this.fetchQuotesNow(); // Immediate first fetch
      this.ensurePolling();
      this.fetchPerformanceData(newSymbols); // Background fetch for period changes
      // Background fetch for IV percentile
      if (this.optionsProvider) {
        this.optionsProvider.fetchIV(newSymbols).catch((err) => {
          log.warn(`IV fetch error: ${(err as Error).message}`);
        });
      }
    }
    log.info(`Yahoo subscriptions: ${this.subscribedSymbols.size} symbols`);
  }

  unsubscribe(symbols: string[]) {
    for (const symbol of symbols) {
      this.subscribedSymbols.delete(symbol);
    }
    if (this.subscribedSymbols.size === 0) {
      this.stopPolling();
    }
    log.info(`Yahoo subscriptions: ${this.subscribedSymbols.size} symbols`);
  }

  unsubscribeAll() {
    this.subscribedSymbols.clear();
    this.stopPolling();
  }

  async switchSymbols(newSymbols: string[]) {
    const currentSet = new Set(this.subscribedSymbols);
    const newSet = new Set(newSymbols);
    const toUnsub = [...currentSet].filter((s) => !newSet.has(s));
    const toSub = newSymbols.filter((s) => !currentSet.has(s));
    if (toUnsub.length > 0) this.unsubscribe(toUnsub);
    if (toSub.length > 0) this.subscribe(toSub);
  }

  getQuote(symbol: string): Partial<StockQuote> | undefined {
    return this.quotes.get(symbol);
  }

  getAllQuotes(): Record<string, Partial<StockQuote>> {
    return Object.fromEntries(this.quotes);
  }

  getActiveCount(): number {
    return this.subscribedSymbols.size;
  }

  private ensurePolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.fetchQuotesNow(), POLL_INTERVAL);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchQuotesNow() {
    if (this.subscribedSymbols.size === 0 || this.isFetching) return;
    this.isFetching = true;

    const symbols = [...this.subscribedSymbols];
    const yahooSymbols = symbols.map(toYahooSymbol);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = (await yahooFinance.quote(yahooSymbols)) as any[];
      const resultsArray = Array.isArray(results) ? results : [results];

      for (const result of resultsArray) {
        if (!result || !result.symbol) continue;

        // Map back from Yahoo symbol to our symbol
        const originalSymbol = fromYahooSymbol(result.symbol);
        // Use original symbol if it's in our subscribed set, otherwise use Yahoo's
        const symbol = this.subscribedSymbols.has(originalSymbol)
          ? originalSymbol
          : this.subscribedSymbols.has(result.symbol)
            ? result.symbol
            : originalSymbol;

        const lastPrice = result.regularMarketPrice ?? null;

        // --- Extract analyst data from quote response ---
        const analystRating: number | null = result.recommendationMean != null
          ? parseFloat(result.recommendationMean.toFixed(2))
          : null;
        const analystTarget: number | null = result.targetMeanPrice != null
          ? parseFloat(result.targetMeanPrice.toFixed(2))
          : null;
        const analystCount: number | null = result.numberOfAnalystOpinions ?? null;

        let upsidePercent: number | null = null;
        if (analystTarget != null && lastPrice != null && lastPrice > 0) {
          upsidePercent = parseFloat(((analystTarget - lastPrice) / lastPrice * 100).toFixed(1));
        }

        const quote: Partial<StockQuote> = {
          symbol,
          lastPrice,
          bidPrice: result.bid ?? null,
          askPrice: result.ask ?? null,
          open: result.regularMarketOpen ?? null,
          high: result.regularMarketDayHigh ?? null,
          low: result.regularMarketDayLow ?? null,
          close: result.regularMarketPreviousClose ?? null,
          volume: result.regularMarketVolume ?? null,
          change: result.regularMarketChange != null
            ? parseFloat(result.regularMarketChange.toFixed(2))
            : null,
          changePercent: result.regularMarketChangePercent != null
            ? parseFloat(result.regularMarketChangePercent.toFixed(2))
            : null,
          high52w: result.fiftyTwoWeekHigh ?? null,
          low52w: result.fiftyTwoWeekLow ?? null,
          analystRating,
          analystTarget,
          analystCount,
          upsidePercent,
          lastUpdate: Date.now(),
        };

        // Merge in cached performance data
        const perfCached = this.performanceCache.get(symbol);
        if (perfCached && Date.now() - perfCached.timestamp < PERFORMANCE_CACHE_TTL) {
          Object.assign(quote, perfCached.data);
        }

        // Merge in cached analytics data
        const analyticsCached = this.analyticsCache.get(symbol);
        if (analyticsCached) {
          Object.assign(quote, analyticsCached);
        }

        // Track volume history and compute volume metrics
        if (quote.volume != null && quote.volume > 0) {
          const history = this.volumeHistory.get(symbol) || [];
          // Only push if this is a different volume than the last entry (new day / new reading)
          if (history.length === 0 || history[history.length - 1] !== quote.volume) {
            history.push(quote.volume);
            if (history.length > VOLUME_HISTORY_LENGTH) {
              history.splice(0, history.length - VOLUME_HISTORY_LENGTH);
            }
            this.volumeHistory.set(symbol, history);
          }

          if (history.length > 1) {
            const avgVolume = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
            quote.volumeAvg20d = avgVolume;
            quote.volumeRatio = parseFloat((quote.volume / avgVolume).toFixed(2));

            if (quote.volumeRatio > VOLUME_ALERT_THRESHOLD) {
              const alert: VolumeAlert = {
                symbol,
                currentVolume: quote.volume,
                avgVolume,
                ratio: quote.volumeRatio,
                timestamp: Date.now(),
              };
              this.emit('volumeAlert', alert);
            }
          }
        }

        // Merge IV percentile if available
        if (this.optionsProvider) {
          const ivPct = this.optionsProvider.getPercentile(symbol);
          if (ivPct != null) {
            quote.ivPercentile = ivPct;
          }
        }

        this.quotes.set(symbol, { ...this.quotes.get(symbol), ...quote });
        this.emit('tick', symbol, this.quotes.get(symbol)!);
      }
    } catch (err) {
      log.error(`Yahoo quote fetch error: ${(err as Error).message}`);
    } finally {
      this.isFetching = false;
    }
  }

  /** Fetch SPY daily bars if not already cached (or stale) */
  private async ensureSpyData(): Promise<void> {
    if (this.spyDailyBars && Date.now() - this.spyFetchTimestamp < PERFORMANCE_CACHE_TTL) return;

    try {
      const endDate = new Date();
      const startDate1y = new Date();
      startDate1y.setFullYear(startDate1y.getFullYear() - 1);
      startDate1y.setDate(startDate1y.getDate() - 7);

      const dailyResult = await (yahooFinance.historical('SPY', {
        period1: startDate1y, period2: endDate, interval: '1d',
      }) as Promise<Array<{ date: Date; close: number }>>);

      if (dailyResult.length > 0) {
        this.spyDailyBars = dailyResult;
        const currentPrice = dailyResult[dailyResult.length - 1].close;
        this.spyPerf = computePerformance(dailyResult, currentPrice);
        this.spyFetchTimestamp = Date.now();
        log.info(`SPY reference data fetched: ${dailyResult.length} daily bars`);
      }
    } catch (err) {
      log.warn(`SPY reference data fetch error: ${(err as Error).message}`);
    }
  }

  private async fetchPerformanceData(symbols: string[]) {
    // Ensure SPY reference data is available before processing symbols
    await this.ensureSpyData();

    for (const symbol of symbols) {
      // Skip if recently cached
      const cached = this.performanceCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < PERFORMANCE_CACHE_TTL) continue;

      try {
        const endDate = new Date();

        // Fetch two ranges: 1Y daily for short-term precision, 10Y weekly for long-term
        const startDate1y = new Date();
        startDate1y.setFullYear(startDate1y.getFullYear() - 1);
        startDate1y.setDate(startDate1y.getDate() - 7);

        const startDateMax = new Date();
        startDateMax.setFullYear(startDateMax.getFullYear() - 10);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [dailyResult, weeklyResult] = await Promise.all([
          (yahooFinance.historical(toYahooSymbol(symbol), {
            period1: startDate1y, period2: endDate, interval: '1d',
          }) as Promise<Array<{ date: Date; close: number }>>),
          (yahooFinance.historical(toYahooSymbol(symbol), {
            period1: startDateMax, period2: startDate1y, interval: '1wk',
          }) as Promise<Array<{ date: Date; close: number }>>),
        ]);

        // Merge: weekly bars first (older), then daily bars (recent)
        const result = [...weeklyResult, ...dailyResult];

        if (result.length === 0) continue;

        // Use live quote price if available, fall back to last bar's close
        const liveQuote = this.quotes.get(symbol);
        const currentPrice = (liveQuote?.lastPrice != null)
          ? liveQuote.lastPrice
          : result[result.length - 1].close;

        const perfData = computePerformance(result, currentPrice);

        // Compute 20-day annualized realized volatility from daily bars
        if (dailyResult.length >= 21) {
          const recentBars = dailyResult.slice(-21); // 21 bars = 20 returns
          const logReturns: number[] = [];
          for (let i = 1; i < recentBars.length; i++) {
            if (recentBars[i - 1].close > 0 && recentBars[i].close > 0) {
              logReturns.push(Math.log(recentBars[i].close / recentBars[i - 1].close));
            }
          }
          if (logReturns.length >= 10) {
            const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
            const vari = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
            const stddev = Math.sqrt(vari);
            perfData.realizedVol = parseFloat((stddev * Math.sqrt(252) * 100).toFixed(2));
          }
        }

        this.performanceCache.set(symbol, { data: perfData, timestamp: Date.now() });

        // --- Compute analytics: suppression, relative strength, momentum, beta ---
        const analytics: AnalyticsData = {
          suppressionScore: null,
          relativeStrength: null,
          momentum: null,
          beta: null,
        };

        // Suppression Score
        if (perfData.change1m != null) {
          let expectedMonthlyReturn: number | null = null;
          if (perfData.change1y != null) {
            expectedMonthlyReturn = perfData.change1y / 12;
          } else if (perfData.change6m != null) {
            expectedMonthlyReturn = perfData.change6m / 6;
          }

          if (expectedMonthlyReturn != null) {
            const monthlyVol = perfData.realizedVol != null
              ? perfData.realizedVol / Math.sqrt(12)
              : 20 / Math.sqrt(12);
            if (monthlyVol > 0) {
              analytics.suppressionScore = parseFloat(
                ((perfData.change1m - expectedMonthlyReturn) / monthlyVol).toFixed(2)
              );
            }
          }
        }

        // Relative Strength vs SPY (3-month period)
        if (perfData.change3m != null && this.spyPerf?.change3m != null) {
          const stockReturn = perfData.change3m;
          const spyReturn = this.spyPerf.change3m;
          const rs = (1 + stockReturn / 100) / (1 + spyReturn / 100);
          analytics.relativeStrength = parseFloat(rs.toFixed(3));
        }

        // Momentum Score (weighted multi-period)
        if (perfData.change1m != null && perfData.change3m != null && perfData.change6m != null) {
          const mom = (perfData.change1m * 3 + perfData.change3m * 2 + perfData.change6m * 1) / 6;
          analytics.momentum = parseFloat(mom.toFixed(2));
        }

        // Rolling 60-day Beta to SPY
        if (this.spyDailyBars && dailyResult.length >= 60) {
          const stockReturns60 = computeLogReturns(dailyResult.slice(-61)); // 61 bars → 60 returns
          const spyReturns60 = computeLogReturns(this.spyDailyBars.slice(-61));

          // Align to same length (take the shorter of the two)
          const len = Math.min(stockReturns60.length, spyReturns60.length);
          if (len >= 30) {
            const sRet = stockReturns60.slice(-len);
            const spRet = spyReturns60.slice(-len);
            const cov = covariance(sRet, spRet);
            const spyVar = variance(spRet);
            if (spyVar > 0) {
              analytics.beta = parseFloat((cov / spyVar).toFixed(3));
            }
          }
        }

        this.analyticsCache.set(symbol, analytics);

        // Emit tick with performance + analytics data merged in
        const existing = this.quotes.get(symbol) || { symbol };
        const updated = { ...existing, ...perfData, ...analytics };
        this.quotes.set(symbol, updated);
        this.emit('tick', symbol, updated);
      } catch (err) {
        log.warn(`Yahoo historical fetch error for ${symbol}: ${(err as Error).message}`);
      }

      // Stagger requests
      await new Promise((r) => setTimeout(r, HISTORICAL_STAGGER_MS));
    }
  }

  destroy() {
    this.stopPolling();
    this.subscribedSymbols.clear();
    this.quotes.clear();
    this.performanceCache.clear();
    this.analyticsCache.clear();
    this.volumeHistory.clear();
    this.spyDailyBars = null;
    this.spyPerf = null;
  }
}
