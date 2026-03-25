import { EventEmitter } from 'events';
import YahooFinance from 'yahoo-finance2';
import type { MacroSignal, MacroData, BreadthData, MacroIndicator } from '../../types.js';
import { log } from '../../utils/logger.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const POLL_INTERVAL = 30_000; // 30 seconds
const TREND_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const ROLLING_WINDOW = 60; // ~30 minutes at 30s polling
const TREND_LOOKBACK = 3; // number of consecutive readings to confirm a trend

// Tickers we need for the 5 macro signals + breadth
const MACRO_TICKERS = [
  '^TNX',   // 10-Year Treasury Yield
  '^IRX',   // 13-Week Treasury Bill (proxy for short-end)
  'GLD',    // Gold ETF
  'SPY',    // S&P 500 ETF
  'DX=F',   // US Dollar Index futures
  '^VIX',   // CBOE Volatility Index
  '^VIX3M', // 3-Month VIX (for term structure)
  'HYG',    // High Yield Corporate Bond ETF
  'LQD',    // Investment Grade Corporate Bond ETF
  'RSP',    // Equal-weight S&P 500 ETF (breadth proxy)
  // Additional tickers for raw indicators display
  'CL=F',     // Crude Oil WTI
  'GC=F',     // Gold Futures
  'HG=F',     // Copper Futures
  'BTC-USD',  // Bitcoin
  'ETH-USD',  // Ethereum
  '^GSPC',    // S&P 500 index
  '^DJI',     // Dow Jones
  '^IXIC',    // Nasdaq Composite
  '^RUT',     // Russell 2000
  'EURUSD=X', // EUR/USD
  'JPY=X',    // USD/JPY
  'GBPUSD=X', // GBP/USD
  '^FVX',     // 5-Year Treasury Yield
];

// Display name mapping for all tickers
const TICKER_DISPLAY_NAMES: Record<string, string> = {
  '^TNX':     '10-Year Treasury Yield',
  '^IRX':     '13-Week Treasury Bill',
  'GLD':      'Gold ETF (GLD)',
  'SPY':      'S&P 500 ETF (SPY)',
  'DX=F':     'US Dollar Index',
  '^VIX':     'VIX',
  '^VIX3M':   '3-Month VIX',
  'HYG':      'High Yield Bond ETF',
  'LQD':      'Investment Grade Bond ETF',
  'RSP':      'Equal-Weight S&P 500',
  'CL=F':     'Crude Oil WTI',
  'GC=F':     'Gold Futures',
  'HG=F':     'Copper Futures',
  'BTC-USD':  'Bitcoin',
  'ETH-USD':  'Ethereum',
  '^GSPC':    'S&P 500',
  '^DJI':     'Dow Jones',
  '^IXIC':    'Nasdaq Composite',
  '^RUT':     'Russell 2000',
  'EURUSD=X': 'EUR/USD',
  'JPY=X':    'USD/JPY',
  'GBPUSD=X': 'GBP/USD',
  '^FVX':     '5-Year Treasury Yield',
};

// Category mapping for all tickers
const TICKER_CATEGORIES: Record<string, MacroIndicator['category']> = {
  '^TNX':     'rate',
  '^IRX':     'rate',
  '^FVX':     'rate',
  'GLD':      'commodity',
  'GC=F':     'commodity',
  'CL=F':     'commodity',
  'HG=F':     'commodity',
  'SPY':      'index',
  'RSP':      'index',
  '^GSPC':    'index',
  '^DJI':     'index',
  '^IXIC':    'index',
  '^RUT':     'index',
  'DX=F':     'currency',
  'EURUSD=X': 'currency',
  'JPY=X':    'currency',
  'GBPUSD=X': 'currency',
  '^VIX':     'volatility',
  '^VIX3M':   'volatility',
  'HYG':      'index',
  'LQD':      'index',
  'BTC-USD':  'crypto',
  'ETH-USD':  'crypto',
};

interface TrendData {
  goldSpyRatio20dSma: number;
  hygLqdRatio20dSma: number;
  dxy20dSma: number;
  rspSpyRatio20dSma: number;
  timestamp: number;
}

/**
 * Manages a rolling window of values for a single indicator.
 * Computes z-scores (how many standard deviations the current value is from the rolling mean)
 * and trend direction (rising/falling/flat based on consecutive directional readings).
 */
class RollingHistory {
  private values: number[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = ROLLING_WINDOW) {
    this.maxSize = maxSize;
  }

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.maxSize) {
      this.values.shift();
    }
  }

  get length(): number {
    return this.values.length;
  }

  get latest(): number | undefined {
    return this.values.length > 0 ? this.values[this.values.length - 1] : undefined;
  }

  get previous(): number | undefined {
    return this.values.length > 1 ? this.values[this.values.length - 2] : undefined;
  }

  /**
   * Compute the z-score of the most recent value relative to the rolling window.
   * Returns null if fewer than 2 data points (can't compute std dev).
   */
  zScore(): number | null {
    if (this.values.length < 2) return null;
    const mean = this.values.reduce((s, v) => s + v, 0) / this.values.length;
    const variance = this.values.reduce((s, v) => s + (v - mean) ** 2, 0) / this.values.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    const current = this.values[this.values.length - 1];
    return (current - mean) / stdDev;
  }

  /**
   * Compute percent change from the previous reading.
   * Returns null if fewer than 2 data points.
   */
  rateOfChange(): number | null {
    if (this.values.length < 2) return null;
    const prev = this.values[this.values.length - 2];
    const curr = this.values[this.values.length - 1];
    if (prev === 0) return null;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  /**
   * Determine trend direction by looking at the last `lookback` readings.
   * 'rising' if value increased for the last `lookback` consecutive readings.
   * 'falling' if value decreased for the last `lookback` consecutive readings.
   * 'flat' otherwise.
   */
  trend(lookback: number = TREND_LOOKBACK): 'rising' | 'falling' | 'flat' {
    // Need at least lookback+1 values to check lookback consecutive changes
    if (this.values.length < lookback + 1) return 'flat';

    const recent = this.values.slice(-(lookback + 1));
    let allRising = true;
    let allFalling = true;

    for (let i = 1; i < recent.length; i++) {
      if (recent[i] <= recent[i - 1]) allRising = false;
      if (recent[i] >= recent[i - 1]) allFalling = false;
    }

    if (allRising) return 'rising';
    if (allFalling) return 'falling';
    return 'flat';
  }
}

export class YahooMacroDataProvider extends EventEmitter {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private trendData: TrendData | null = null;
  private latestData: MacroData | null = null;
  private isFetching = false;

  // Rolling histories keyed by signal name
  private histories: Record<string, RollingHistory> = {
    'yieldSpread': new RollingHistory(),
    'goldSpyRatio': new RollingHistory(),
    'dxy': new RollingHistory(),
    'vix': new RollingHistory(),
    'creditSpread': new RollingHistory(),
    'rspSpyRatio': new RollingHistory(),
  };

  async start() {
    log.info(`Macro provider starting (${MACRO_TICKERS.length} tickers, ${POLL_INTERVAL / 1000}s interval, z-score window=${ROLLING_WINDOW})`);
    // Fetch trend data (20-day SMAs) first
    await this.fetchTrendData();
    // Initial fetch
    await this.fetchMacroData();
    // Start polling
    this.pollTimer = setInterval(() => this.fetchMacroData(), POLL_INTERVAL);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getLatest(): MacroData | null {
    return this.latestData;
  }

  destroy() {
    this.stop();
    this.latestData = null;
    this.trendData = null;
    // Reset all rolling histories
    for (const key of Object.keys(this.histories)) {
      this.histories[key] = new RollingHistory();
    }
  }

  /**
   * Build a MacroSignal using rolling z-score for regime classification instead of hardcoded thresholds.
   *
   * @param name        Display name for the signal
   * @param value       Current indicator value
   * @param label       Human-readable label
   * @param historyKey  Key into this.histories
   * @param invertZScore If true, a HIGH z-score means risk-off (e.g. VIX, Gold/SPY, DXY).
   *                     If false, a HIGH z-score means risk-on (e.g. HYG/LQD, Yield Spread).
   * @param regimeOverride Optional function to override z-score-based regime with domain logic
   */
  private buildSignal(
    name: string,
    value: number,
    label: string,
    historyKey: string,
    invertZScore: boolean,
    regimeOverride?: (zScore: number | null, trend: 'rising' | 'falling' | 'flat') => MacroSignal['regime'] | null,
  ): MacroSignal {
    const history = this.histories[historyKey];
    history.push(value);

    const zScore = history.zScore();
    const trend = history.trend();
    const rateOfChange = history.rateOfChange();

    // Z-score-based regime classification
    let regime: MacroSignal['regime'] = 'caution';
    if (zScore !== null) {
      if (invertZScore) {
        // High values = risk-off (VIX, Gold/SPY, DXY)
        if (zScore > 1) regime = 'risk-off';
        else if (zScore < -1) regime = 'risk-on';
      } else {
        // High values = risk-on (Yield Spread, HYG/LQD)
        if (zScore > 1) regime = 'risk-on';
        else if (zScore < -1) regime = 'risk-off';
      }
    }

    // Allow domain-specific overrides (e.g., VIX term structure)
    if (regimeOverride) {
      const override = regimeOverride(zScore, trend);
      if (override !== null) regime = override;
    }

    return {
      name,
      value,
      label,
      regime,
      zScore: zScore !== null ? parseFloat(zScore.toFixed(2)) : null,
      trend,
      rateOfChange: rateOfChange !== null ? parseFloat(rateOfChange.toFixed(4)) : null,
    };
  }

  private async fetchTrendData() {
    if (this.trendData && Date.now() - this.trendData.timestamp < TREND_CACHE_TTL) {
      return;
    }

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 40); // Extra buffer for 20 trading days

      // Fetch daily bars for GLD, SPY, HYG, LQD, DX=F, RSP
      const [gldBars, spyBars, hygBars, lqdBars, dxyBars, rspBars] = await Promise.all(
        ['GLD', 'SPY', 'HYG', 'LQD', 'DX=F', 'RSP'].map(async (ticker) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = (await yahooFinance.historical(ticker, {
            period1: startDate,
            period2: endDate,
            interval: '1d',
          })) as Array<{ date: Date; close: number }>;
          return result;
        }),
      );

      const last20 = (bars: Array<{ close: number }>) =>
        bars.slice(-20).reduce((sum, b) => sum + b.close, 0) / Math.min(bars.length, 20);

      const goldSpyRatios = gldBars.slice(-20).map((g, i) => {
        const spy = spyBars.slice(-20)[i];
        return spy ? g.close / spy.close : 0;
      });
      const goldSpyRatio20dSma =
        goldSpyRatios.reduce((s, v) => s + v, 0) / goldSpyRatios.length;

      const hygLqdRatios = hygBars.slice(-20).map((h, i) => {
        const lqd = lqdBars.slice(-20)[i];
        return lqd ? h.close / lqd.close : 0;
      });
      const hygLqdRatio20dSma =
        hygLqdRatios.reduce((s, v) => s + v, 0) / hygLqdRatios.length;

      const dxy20dSma = last20(dxyBars);

      // RSP/SPY ratio 20d SMA for breadth
      const rspSpyRatios = rspBars.slice(-20).map((r, i) => {
        const spy = spyBars.slice(-20)[i];
        return spy ? r.close / spy.close : 0;
      });
      const rspSpyRatio20dSma =
        rspSpyRatios.reduce((s, v) => s + v, 0) / rspSpyRatios.length;

      this.trendData = {
        goldSpyRatio20dSma,
        hygLqdRatio20dSma,
        dxy20dSma,
        rspSpyRatio20dSma,
        timestamp: Date.now(),
      };

      log.debug(
        `Macro trend data: GLD/SPY SMA=${goldSpyRatio20dSma.toFixed(4)}, HYG/LQD SMA=${hygLqdRatio20dSma.toFixed(4)}, DXY SMA=${dxy20dSma.toFixed(2)}, RSP/SPY SMA=${rspSpyRatio20dSma.toFixed(4)}`,
      );
    } catch (err) {
      log.error(`Macro trend data fetch error: ${(err as Error).message}`);
    }
  }

  private async fetchMacroData() {
    if (this.isFetching) return;
    this.isFetching = true;

    try {
      // Refresh trend data if stale
      await this.fetchTrendData();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = (await yahooFinance.quote(MACRO_TICKERS)) as any[];
      const resultsArray = Array.isArray(results) ? results : [results];

      // Build a map of ticker -> price and full quote data for indicators
      const prices: Record<string, number> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quoteMap: Record<string, any> = {};
      for (const r of resultsArray) {
        if (!r || !r.symbol) continue;
        prices[r.symbol] = r.regularMarketPrice ?? 0;
        quoteMap[r.symbol] = r;
      }

      const signals: MacroSignal[] = [];

      // 1. Yield Spread (10Y - 3M as proxy for 10Y-2Y)
      const tnx = prices['^TNX']; // Already in percentage (e.g. 4.25)
      const irx = prices['^IRX']; // Already in percentage (e.g. 4.50)
      if (tnx != null && irx != null) {
        const spread = parseFloat((tnx - irx).toFixed(2));
        // Yield spread: higher = risk-on (normal curve), lower = risk-off (inversion)
        // invertZScore=false: high z-score -> risk-on
        signals.push(this.buildSignal(
          'Yield Spread',
          spread,
          `10Y-3M: ${spread > 0 ? '+' : ''}${spread.toFixed(2)}%`,
          'yieldSpread',
          false, // high spread = healthy = risk-on
        ));
      }

      // 2. Gold/SPY Ratio
      const gldPrice = prices['GLD'];
      const spyPrice = prices['SPY'];
      if (gldPrice && spyPrice && this.trendData) {
        const ratio = parseFloat((gldPrice / spyPrice).toFixed(4));
        const sma = this.trendData.goldSpyRatio20dSma;
        const pctAboveSma = ((ratio - sma) / sma) * 100;
        // Rising Gold/SPY = flight to safety = risk-off
        // invertZScore=true: high z-score -> risk-off
        signals.push(this.buildSignal(
          'Gold/SPY',
          ratio,
          `Ratio: ${ratio.toFixed(3)} (${pctAboveSma > 0 ? '+' : ''}${pctAboveSma.toFixed(1)}% vs SMA)`,
          'goldSpyRatio',
          true, // high ratio = flight to safety = risk-off
        ));
      }

      // 3. Dollar (DXY)
      const dxy = prices['DX=F'];
      if (dxy && this.trendData) {
        const sma = this.trendData.dxy20dSma;
        const pctAboveSma = ((dxy - sma) / sma) * 100;
        // Strong + rising dollar = headwind for risk assets
        // invertZScore=true: high z-score -> risk-off
        signals.push(this.buildSignal(
          'Dollar (DXY)',
          parseFloat(dxy.toFixed(2)),
          `DXY: ${dxy.toFixed(2)} (${pctAboveSma > 0 ? '+' : ''}${pctAboveSma.toFixed(1)}% vs SMA)`,
          'dxy',
          true, // strong dollar = headwind = risk-off
        ));
      }

      // 4. VIX + Term Structure
      const vix = prices['^VIX'];
      const vix3m = prices['^VIX3M'];
      if (vix != null) {
        let termLabel = '';
        const isBackwardation = vix3m ? vix > vix3m : false;
        if (vix3m) {
          termLabel = isBackwardation ? ' (Backwardation)' : ' (Contango)';
        }

        // invertZScore=true: high VIX z-score -> risk-off
        // Override: VIX backwardation bumps regime toward risk-off
        signals.push(this.buildSignal(
          'VIX',
          parseFloat(vix.toFixed(2)),
          `VIX: ${vix.toFixed(2)}${termLabel}`,
          'vix',
          true, // high VIX = fear = risk-off
          (zScore, _trend) => {
            // If in backwardation (near-term fear > long-term), escalate regime
            if (isBackwardation && zScore !== null) {
              // Backwardation: bump up one level toward risk-off
              if (zScore > 1) return 'risk-off';    // already risk-off, stays
              if (zScore > -1) return 'risk-off';   // caution -> risk-off
              return 'caution';                      // risk-on -> caution
            }
            return null; // no override, use z-score-based regime
          },
        ));
      }

      // 5. Credit Spreads (HYG/LQD ratio as proxy)
      const hygPrice = prices['HYG'];
      const lqdPrice = prices['LQD'];
      if (hygPrice && lqdPrice && this.trendData) {
        const ratio = parseFloat((hygPrice / lqdPrice).toFixed(4));
        const sma = this.trendData.hygLqdRatio20dSma;
        const pctAboveSma = ((ratio - sma) / sma) * 100;
        // Rising HYG/LQD = tightening credit spreads = risk-on
        // invertZScore=false: high z-score -> risk-on
        signals.push(this.buildSignal(
          'Credit Spreads',
          ratio,
          `HYG/LQD: ${ratio.toFixed(3)} (${pctAboveSma > 0 ? '+' : ''}${pctAboveSma.toFixed(1)}% vs SMA)`,
          'creditSpread',
          false, // high HYG/LQD ratio = tight spreads = risk-on
        ));
      }

      // 6. Breadth: RSP/SPY ratio
      let breadth: BreadthData | null = null;
      const rspPrice = prices['RSP'];
      if (rspPrice && spyPrice) {
        const rspSpyRatio = parseFloat((rspPrice / spyPrice).toFixed(4));
        const rspHistory = this.histories['rspSpyRatio'];
        rspHistory.push(rspSpyRatio);

        const rspZScore = rspHistory.zScore();
        const rspTrend = rspHistory.trend();

        // Rising RSP/SPY = broadening participation = risk-on
        let breadthRegime: BreadthData['regime'] = 'caution';
        if (rspZScore !== null) {
          if (rspZScore > 1) breadthRegime = 'risk-on';
          else if (rspZScore < -1) breadthRegime = 'risk-off';
        }

        const smaLabel = this.trendData
          ? (() => {
              const pct = ((rspSpyRatio - this.trendData!.rspSpyRatio20dSma) / this.trendData!.rspSpyRatio20dSma) * 100;
              return ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs SMA)`;
            })()
          : '';

        breadth = {
          rspSpyRatio,
          rspSpyRatioZScore: rspZScore !== null ? parseFloat(rspZScore.toFixed(2)) : null,
          rspSpyTrend: rspTrend,
          label: `RSP/SPY: ${rspSpyRatio.toFixed(4)}${smaLabel}`,
          regime: breadthRegime,
        };
      }

      // Build raw indicators array from ALL fetched tickers
      const indicators: MacroIndicator[] = [];
      for (const ticker of MACRO_TICKERS) {
        const q = quoteMap[ticker];
        if (!q) continue;
        const price = q.regularMarketPrice;
        if (price == null) continue;

        indicators.push({
          symbol: ticker,
          name: TICKER_DISPLAY_NAMES[ticker] ?? ticker,
          value: price,
          change: q.regularMarketChange ?? 0,
          changePercent: q.regularMarketChangePercent ?? 0,
          category: TICKER_CATEGORIES[ticker] ?? 'index',
        });
      }

      this.latestData = {
        signals,
        breadth,
        indicators,
        vix: vix ?? null,
        lastUpdate: Date.now(),
      };

      this.emit('macro', this.latestData);

      const zScoreSummary = signals
        .map((s) => `${s.name}:z=${s.zScore ?? '?'}/${s.trend}`)
        .join(', ');
      log.debug(`Macro update: ${signals.length} signals, ${indicators.length} indicators, VIX=${vix?.toFixed(2) ?? 'N/A'}, breadth=${breadth ? breadth.regime : 'N/A'} [${zScoreSummary}]`);
    } catch (err) {
      log.error(`Macro data fetch error: ${(err as Error).message}`);
    } finally {
      this.isFetching = false;
    }
  }
}
