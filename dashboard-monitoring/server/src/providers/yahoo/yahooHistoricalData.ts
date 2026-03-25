import YahooFinance from 'yahoo-finance2';
import type { IHistoricalDataProvider } from '../types.js';
import type { BarData } from '../../types.js';
import { log } from '../../utils/logger.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

type YahooInterval = '1d' | '1wk' | '1mo';

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-');
}

function parseDurationAndBarSize(
  duration: string,
  barSize: string,
): { startDate: Date; interval: YahooInterval } {
  const startDate = new Date();
  const parts = duration.trim().split(/\s+/);
  const num = parseInt(parts[0], 10) || 1;
  const unit = (parts[1] || 'M').toUpperCase();

  switch (unit) {
    case 'D':
      startDate.setDate(startDate.getDate() - num);
      break;
    case 'W':
      startDate.setDate(startDate.getDate() - num * 7);
      break;
    case 'M':
      startDate.setMonth(startDate.getMonth() - num);
      break;
    case 'Y':
      startDate.setFullYear(startDate.getFullYear() - num);
      break;
    default:
      startDate.setMonth(startDate.getMonth() - 1);
  }

  let interval: YahooInterval = '1d';
  const bs = barSize.toLowerCase();
  if (bs.includes('week')) interval = '1wk';
  else if (bs.includes('month')) interval = '1mo';
  // Yahoo historical() only supports 1d/1wk/1mo — intraday falls back to daily

  return { startDate, interval };
}

export class YahooHistoricalDataProvider implements IHistoricalDataProvider {
  private cache: Map<string, { bars: BarData[]; timestamp: number }> = new Map();

  async requestBars(
    symbol: string,
    duration = '1 M',
    barSize = '1 day',
  ): Promise<BarData[]> {
    const cacheKey = `${symbol}:${duration}:${barSize}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.bars;
    }

    try {
      const { startDate, interval } = parseDurationAndBarSize(duration, barSize);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await yahooFinance.historical(toYahooSymbol(symbol), {
        period1: startDate,
        period2: new Date(),
        interval,
      })) as Array<{ date: Date; open: number; high: number; low: number; close: number; volume: number }>;

      const bars: BarData[] = result.map((row) => ({
        time: row.date.toISOString().split('T')[0],
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }));

      this.cache.set(cacheKey, { bars, timestamp: Date.now() });
      log.debug(`Yahoo historical: ${symbol} → ${bars.length} bars (${interval})`);
      return bars;
    } catch (err) {
      log.error(`Yahoo historical error for ${symbol}: ${(err as Error).message}`);
      return [];
    }
  }
}
