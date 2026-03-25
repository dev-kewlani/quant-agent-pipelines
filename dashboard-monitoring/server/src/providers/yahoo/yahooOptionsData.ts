import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';
import { log } from '../../utils/logger.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const STAGGER_MS = 250; // Delay between options requests
const REFRESH_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
const MAX_HISTORY_DAYS = 252; // ~1 year of trading days
const HV_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const HV_LOOKBACK_DAYS = 30; // Trading days for realized vol calculation
const IV_HISTORY_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../data/iv-history.json',
);

interface IVEntry {
  date: string; // YYYY-MM-DD
  iv: number;
}

interface HVCacheEntry {
  value: number;
  fetchedAt: number; // Date.now() timestamp
}

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-');
}

export class YahooOptionsDataProvider {
  private ivHistory: Map<string, IVEntry[]> = new Map();
  private currentIV: Map<string, number> = new Map();
  private realizedVolCache: Map<string, HVCacheEntry> = new Map();
  private subscribedSymbols: Set<string> = new Set();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isFetching = false;

  constructor() {
    this.loadFromDisk();
  }

  /**
   * Fetch IV for a batch of symbols (called on subscribe).
   * Also fetches realized volatility for IV/HV ratio computation.
   */
  async fetchIV(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      this.subscribedSymbols.add(symbol);
    }

    if (this.isFetching) return;
    this.isFetching = true;

    const today = new Date().toISOString().split('T')[0];

    for (const symbol of symbols) {
      try {
        const yahooSymbol = toYahooSymbol(symbol);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const optionsResult = (await yahooFinance.options(yahooSymbol)) as any;

        if (!optionsResult || !optionsResult.options || optionsResult.options.length === 0) {
          continue;
        }

        const chain = optionsResult.options[0];
        const lastPrice = optionsResult.quote?.regularMarketPrice;

        if (!lastPrice || !chain.calls || !chain.puts) {
          continue;
        }

        // Find ATM strike (closest to last price)
        const allStrikes = chain.calls.map((c: { strike: number }) => c.strike);
        if (allStrikes.length === 0) continue;

        let atmStrike = allStrikes[0];
        let minDiff = Math.abs(allStrikes[0] - lastPrice);
        for (const strike of allStrikes) {
          const diff = Math.abs(strike - lastPrice);
          if (diff < minDiff) {
            minDiff = diff;
            atmStrike = strike;
          }
        }

        // Get ATM call and put IV
        const atmCall = chain.calls.find(
          (c: { strike: number; impliedVolatility: number }) => c.strike === atmStrike,
        );
        const atmPut = chain.puts.find(
          (p: { strike: number; impliedVolatility: number }) => p.strike === atmStrike,
        );

        let iv: number | null = null;
        if (atmCall?.impliedVolatility && atmPut?.impliedVolatility) {
          iv = (atmCall.impliedVolatility + atmPut.impliedVolatility) / 2;
        } else if (atmCall?.impliedVolatility) {
          iv = atmCall.impliedVolatility;
        } else if (atmPut?.impliedVolatility) {
          iv = atmPut.impliedVolatility;
        }

        if (iv != null && iv > 0) {
          iv = parseFloat((iv * 100).toFixed(2)); // Convert to percentage
          this.currentIV.set(symbol, iv);

          // Store in history (one entry per day)
          const history = this.ivHistory.get(symbol) || [];
          const existingToday = history.find((h) => h.date === today);
          if (existingToday) {
            existingToday.iv = iv;
          } else {
            history.push({ date: today, iv });
          }

          // Prune to max history length
          if (history.length > MAX_HISTORY_DAYS) {
            history.splice(0, history.length - MAX_HISTORY_DAYS);
          }
          this.ivHistory.set(symbol, history);

          log.debug(`IV for ${symbol}: ${iv.toFixed(1)}% (ATM strike ${atmStrike})`);
        }
      } catch (err) {
        log.warn(`Options data error for ${symbol}: ${(err as Error).message}`);
      }

      // Stagger requests
      await new Promise((r) => setTimeout(r, STAGGER_MS));

      // Also fetch realized volatility (respects cache TTL internally)
      try {
        await this.computeRealizedVol(symbol);
      } catch (err) {
        log.warn(`HV data error for ${symbol}: ${(err as Error).message}`);
      }

      // Stagger after HV fetch too
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }

    this.isFetching = false;
    this.saveToDisk();

    // Ensure refresh timer is running
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(
        () => this.refreshSubscribed(),
        REFRESH_INTERVAL,
      );
    }
  }

  /**
   * Get IV percentile for a symbol (0-100 integer, or null if no history).
   * Shows what % of historical IV readings are below current IV.
   */
  getPercentile(symbol: string): number | null {
    const currentIv = this.currentIV.get(symbol);
    const history = this.ivHistory.get(symbol);

    if (currentIv == null || !history || history.length < 5) {
      return null;
    }

    // Percentile rank: what % of historical readings are below current IV
    const ivValues = history.map((h) => h.iv);
    const below = ivValues.filter((v) => v < currentIv).length;
    return Math.round((below / ivValues.length) * 100);
  }

  /**
   * Get IV rank for a symbol (0-100, or null if insufficient history).
   * IV Rank = (currentIV - minIV) / (maxIV - minIV) * 100
   * Shows where current IV sits within its 52-week high/low range.
   */
  getRank(symbol: string): number | null {
    const currentIv = this.currentIV.get(symbol);
    const history = this.ivHistory.get(symbol);

    if (currentIv == null || !history || history.length < 5) {
      return null;
    }

    const ivValues = history.map((h) => h.iv);
    const minIv = Math.min(...ivValues);
    const maxIv = Math.max(...ivValues);

    // Avoid division by zero when all historical values are identical
    if (maxIv === minIv) {
      return 50;
    }

    const rank = ((currentIv - minIv) / (maxIv - minIv)) * 100;
    return Math.round(Math.max(0, Math.min(100, rank)));
  }

  /**
   * Get cached realized (historical) volatility for a symbol, or null if not yet computed.
   */
  getRealizedVol(symbol: string): number | null {
    const cached = this.realizedVolCache.get(symbol);
    if (!cached) return null;

    // Return even if stale — caller just wants the last known value
    return cached.value;
  }

  /**
   * Get IV/HV ratio for a symbol, or null if either value is unavailable.
   * Values > 1.5 mean options are expensive relative to actual stock movement.
   */
  getIvHvRatio(symbol: string): number | null {
    const currentIv = this.currentIV.get(symbol);
    const hv = this.getRealizedVol(symbol);

    if (currentIv == null || hv == null || hv === 0) {
      return null;
    }

    return parseFloat((currentIv / hv).toFixed(2));
  }

  /**
   * Get all percentiles for subscribed symbols.
   */
  getAllPercentiles(): Record<string, number | null> {
    const result: Record<string, number | null> = {};
    for (const symbol of this.subscribedSymbols) {
      result[symbol] = this.getPercentile(symbol);
    }
    return result;
  }

  /**
   * Compute annualized realized volatility (HV) from 30 days of daily price data.
   * Uses log returns and annualizes with sqrt(252).
   * Results are cached with a 1-hour TTL.
   */
  private async computeRealizedVol(symbol: string): Promise<number | null> {
    // Check cache first
    const cached = this.realizedVolCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < HV_CACHE_TTL) {
      return cached.value;
    }

    const yahooSymbol = toYahooSymbol(symbol);

    // Fetch ~45 calendar days to get ~30 trading days of data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 45);

    const historicalData = await yahooFinance.historical(yahooSymbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    if (!historicalData || historicalData.length < 2) {
      log.debug(`HV: insufficient historical data for ${symbol} (${historicalData?.length ?? 0} bars)`);
      return null;
    }

    // Use up to HV_LOOKBACK_DAYS + 1 bars (need n+1 closes for n returns)
    const bars = historicalData.slice(-(HV_LOOKBACK_DAYS + 1));

    // Compute daily log returns
    const logReturns: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const prevClose = bars[i - 1].close;
      const currClose = bars[i].close;
      if (prevClose != null && currClose != null && prevClose > 0) {
        logReturns.push(Math.log(currClose / prevClose));
      }
    }

    if (logReturns.length < 5) {
      log.debug(`HV: too few log returns for ${symbol} (${logReturns.length})`);
      return null;
    }

    // Standard deviation of log returns
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance =
      logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
    const stddev = Math.sqrt(variance);

    // Annualize: stddev * sqrt(252) * 100 to get percentage
    const annualizedHV = parseFloat((stddev * Math.sqrt(252) * 100).toFixed(2));

    // Cache the result
    this.realizedVolCache.set(symbol, { value: annualizedHV, fetchedAt: Date.now() });
    log.debug(`HV for ${symbol}: ${annualizedHV.toFixed(1)}%`);

    return annualizedHV;
  }

  private async refreshSubscribed() {
    const symbols = [...this.subscribedSymbols];
    if (symbols.length > 0) {
      log.debug(`Refreshing IV data for ${symbols.length} symbols`);
      await this.fetchIV(symbols);
    }
  }

  private loadFromDisk() {
    try {
      if (existsSync(IV_HISTORY_FILE)) {
        const raw = readFileSync(IV_HISTORY_FILE, 'utf-8');
        const data = JSON.parse(raw) as Record<string, IVEntry[]>;

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const cutoff = oneYearAgo.toISOString().split('T')[0];

        for (const [symbol, entries] of Object.entries(data)) {
          // Prune old entries
          const recent = entries.filter((e) => e.date >= cutoff);
          if (recent.length > 0) {
            this.ivHistory.set(symbol, recent);
            // Set current IV to the most recent entry
            this.currentIV.set(symbol, recent[recent.length - 1].iv);
          }
        }
        log.info(`Loaded IV history for ${this.ivHistory.size} symbols from disk`);
      }
    } catch (err) {
      log.warn(`Failed to load IV history: ${(err as Error).message}`);
    }
  }

  private saveToDisk() {
    try {
      const dir = dirname(IV_HISTORY_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: Record<string, IVEntry[]> = {};
      for (const [symbol, entries] of this.ivHistory) {
        data[symbol] = entries;
      }
      writeFileSync(IV_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
      log.debug(`Saved IV history for ${this.ivHistory.size} symbols to disk`);
    } catch (err) {
      log.warn(`Failed to save IV history: ${(err as Error).message}`);
    }
  }

  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.saveToDisk();
  }
}
