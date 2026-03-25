import { EventName, BarSizeSetting } from '@stoqey/ib';
import type { IBKRConnection } from './connection.js';
import { createContract } from './contracts.js';
import type { BarData } from '../types.js';
import { log } from '../utils/logger.js';

const barSizeMap: Record<string, BarSizeSetting> = {
  '1 day': BarSizeSetting.DAYS_ONE,
  '1 hour': BarSizeSetting.HOURS_ONE,
  '5 mins': BarSizeSetting.MINUTES_FIVE,
  '1 min': BarSizeSetting.MINUTES_ONE,
  '1 week': BarSizeSetting.WEEKS_ONE,
};

const REQUEST_TIMEOUT = 30_000; // 30 seconds

interface HistoricalRequest {
  symbol: string;
  resolve: (bars: BarData[]) => void;
  reject: (err: Error) => void;
  bars: BarData[];
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export class HistoricalDataManager {
  private nextReqId = 5000;
  private pendingRequests: Map<number, HistoricalRequest> = new Map();
  private cache: Map<string, { bars: BarData[]; timestamp: number }> = new Map();
  private requestQueue: Array<() => void> = [];
  private processing = false;

  private static CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private static REQUEST_SPACING = 250; // ms between requests

  constructor(private connection: IBKRConnection) {
    this.setupHandlers();
  }

  private setupHandlers() {
    const api = this.connection.api;

    api.on(
      EventName.historicalData,
      (reqId: number, time: string, open: number, high: number, low: number, close: number, volume: number) => {
        const req = this.pendingRequests.get(reqId);
        if (!req) return;

        // "finished" marker
        if (time.startsWith('finished')) {
          clearTimeout(req.timeoutHandle);
          this.pendingRequests.delete(reqId);
          this.cache.set(req.symbol, { bars: req.bars, timestamp: Date.now() });
          req.resolve(req.bars);
          return;
        }

        req.bars.push({ time, open, high, low, close, volume });
      },
    );

    api.on(EventName.error, (err: Error, _code: number, reqId: number) => {
      const req = this.pendingRequests.get(reqId);
      if (req) {
        clearTimeout(req.timeoutHandle);
        this.pendingRequests.delete(reqId);
        req.reject(err);
      }
    });
  }

  async requestBars(symbol: string, duration = '1 M', barSize = '1 day'): Promise<BarData[]> {
    // Check cache
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < HistoricalDataManager.CACHE_TTL) {
      return cached.bars;
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push(() => {
        if (!this.connection.isConnected()) {
          reject(new Error('Not connected'));
          return;
        }

        const reqId = this.nextReqId++;
        const contract = createContract(symbol);

        const timeoutHandle = setTimeout(() => {
          const pending = this.pendingRequests.get(reqId);
          if (pending) {
            this.pendingRequests.delete(reqId);
            log.warn(`Historical data request for ${symbol} (reqId=${reqId}) timed out after ${REQUEST_TIMEOUT / 1000}s`);
            pending.reject(new Error(`Historical data request for ${symbol} timed out after ${REQUEST_TIMEOUT / 1000}s`));
          }
        }, REQUEST_TIMEOUT);

        this.pendingRequests.set(reqId, { symbol, resolve, reject, bars: [], timeoutHandle });

        try {
          this.connection.api.reqHistoricalData(
            reqId,
            contract,
            '', // endDateTime = now
            duration,
            barSizeMap[barSize] || BarSizeSetting.DAYS_ONE,
            'TRADES',
            1, // useRTH
            1, // formatDate
            false,
          );
          log.debug(`Requested historical data for ${symbol} (reqId=${reqId})`);
        } catch (err) {
          clearTimeout(timeoutHandle);
          this.pendingRequests.delete(reqId);
          reject(err as Error);
        }
      });

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift();
      if (next) next();
      await new Promise((r) => setTimeout(r, HistoricalDataManager.REQUEST_SPACING));
    }

    this.processing = false;
  }
}
