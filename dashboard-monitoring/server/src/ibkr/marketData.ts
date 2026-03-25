import { EventEmitter } from 'events';
import { EventName, TickType } from '@stoqey/ib';
import type { IBKRConnection } from './connection.js';
import { createContract } from './contracts.js';
import { processTickPrice, processTickSize } from './tickProcessor.js';
import type { StockQuote } from '../types.js';
import { log } from '../utils/logger.js';

const MAX_SUBSCRIPTIONS = 95; // Leave 5 buffer from the 100 limit
const GENERIC_TICKS = '165'; // 52-week high/low

export class MarketDataManager extends EventEmitter {
  private reqIdToSymbol: Map<number, string> = new Map();
  private symbolToReqId: Map<string, number> = new Map();
  private quotes: Map<string, Partial<StockQuote>> = new Map();
  private nextReqId = 1000;

  constructor(private connection: IBKRConnection) {
    super();
    this.setupTickHandlers();
  }

  private setupTickHandlers() {
    const api = this.connection.api;

    api.on(EventName.tickPrice, (reqId: number, field: number, price: number) => {
      const symbol = this.reqIdToSymbol.get(reqId);
      if (!symbol) return;

      const quote = this.quotes.get(symbol) || { symbol };
      if (processTickPrice(quote, field, price)) {
        this.quotes.set(symbol, quote);
        this.emit('tick', symbol, quote);
      }
    });

    api.on(EventName.tickSize, (reqId: number, field?: TickType, size?: number) => {
      if (field == null || size == null) return;
      const symbol = this.reqIdToSymbol.get(reqId);
      if (!symbol) return;

      const quote = this.quotes.get(symbol) || { symbol };
      if (processTickSize(quote, field as number, size)) {
        this.quotes.set(symbol, quote);
        this.emit('tick', symbol, quote);
      }
    });
  }

  subscribe(symbols: string[]) {
    if (!this.connection.isConnected()) {
      log.warn('Cannot subscribe: not connected to TWS');
      return;
    }

    for (const symbol of symbols) {
      if (this.symbolToReqId.has(symbol)) {
        continue; // Already subscribed
      }

      if (this.symbolToReqId.size >= MAX_SUBSCRIPTIONS) {
        log.warn(`Subscription limit reached (${MAX_SUBSCRIPTIONS}), skipping ${symbol}`);
        break;
      }

      const reqId = this.nextReqId++;
      const contract = createContract(symbol);

      this.reqIdToSymbol.set(reqId, symbol);
      this.symbolToReqId.set(symbol, reqId);

      try {
        this.connection.api.reqMktData(reqId, contract, GENERIC_TICKS, false, false);
        log.debug(`Subscribed ${symbol} (reqId=${reqId})`);
      } catch (err) {
        log.error(`Failed to subscribe ${symbol}:`, err);
        this.reqIdToSymbol.delete(reqId);
        this.symbolToReqId.delete(symbol);
      }
    }

    log.info(`Active subscriptions: ${this.symbolToReqId.size}`);
  }

  unsubscribe(symbols: string[]) {
    for (const symbol of symbols) {
      const reqId = this.symbolToReqId.get(symbol);
      if (reqId == null) continue;

      try {
        this.connection.api.cancelMktData(reqId);
      } catch {
        // Ignore cancel errors
      }

      this.reqIdToSymbol.delete(reqId);
      this.symbolToReqId.delete(symbol);
      log.debug(`Unsubscribed ${symbol} (reqId=${reqId})`);
    }

    log.info(`Active subscriptions: ${this.symbolToReqId.size}`);
  }

  unsubscribeAll() {
    const allSymbols = Array.from(this.symbolToReqId.keys());
    this.unsubscribe(allSymbols);
  }

  async switchSymbols(newSymbols: string[]) {
    const currentSymbols = new Set(this.symbolToReqId.keys());
    const newSet = new Set(newSymbols);

    const toUnsub = [...currentSymbols].filter((s) => !newSet.has(s));
    const toSub = newSymbols.filter((s) => !currentSymbols.has(s));

    if (toUnsub.length > 0) {
      this.unsubscribe(toUnsub);
    }

    // Small delay to let cancellations process
    if (toUnsub.length > 0 && toSub.length > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (toSub.length > 0) {
      this.subscribe(toSub);
    }
  }

  getQuote(symbol: string): Partial<StockQuote> | undefined {
    return this.quotes.get(symbol);
  }

  getAllQuotes(): Record<string, Partial<StockQuote>> {
    return Object.fromEntries(this.quotes);
  }

  getActiveCount(): number {
    return this.symbolToReqId.size;
  }
}
