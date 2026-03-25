import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { StockQuote } from '../types.js';
import { log } from './logger.js';

const CACHE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../data/quote-cache.json',
);

const SAVE_INTERVAL = 60 * 1000; // 60 seconds

export class QuoteCache {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private getQuotes: () => Record<string, Partial<StockQuote>>,
    private setQuotes: (q: Record<string, Partial<StockQuote>>) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.saveToDisk(), SAVE_INTERVAL);
    log.info('QuoteCache: started (saving every 60s)');
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.saveToDisk();
    log.info('QuoteCache: destroyed (final save complete)');
  }

  private saveToDisk(): void {
    try {
      const quotes = this.getQuotes();
      const keys = Object.keys(quotes);
      if (keys.length === 0) return;

      const dir = dirname(CACHE_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(CACHE_FILE, JSON.stringify(quotes, null, 2), 'utf-8');
      log.debug(`QuoteCache: saved ${keys.length} quotes to disk`);
    } catch (err) {
      log.warn(`QuoteCache: failed to save - ${(err as Error).message}`);
    }
  }

  static loadFromDisk(): Record<string, Partial<StockQuote>> | null {
    try {
      if (!existsSync(CACHE_FILE)) {
        return null;
      }

      const raw = readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw) as Record<string, Partial<StockQuote>>;

      const count = Object.keys(data).length;
      if (count === 0) return null;

      log.info(`QuoteCache: loaded ${count} quotes from disk`);
      return data;
    } catch (err) {
      log.warn(`QuoteCache: failed to load - ${(err as Error).message}`);
      return null;
    }
  }
}
