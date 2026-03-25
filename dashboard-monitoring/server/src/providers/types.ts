import type { EventEmitter } from 'events';
import type { StockQuote, BarData, VolumeAlert } from '../types.js';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export interface IConnectionProvider extends EventEmitter {
  readonly status: ConnectionStatus;
  connect(): void;
  disconnect(): void;
  isConnected(): boolean;
  // Emits: 'statusChange' (status: ConnectionStatus)
}

export interface IMarketDataProvider extends EventEmitter {
  subscribe(symbols: string[]): void;
  unsubscribe(symbols: string[]): void;
  unsubscribeAll(): void;
  switchSymbols(newSymbols: string[]): Promise<void>;
  getQuote(symbol: string): Partial<StockQuote> | undefined;
  getAllQuotes(): Record<string, Partial<StockQuote>>;
  getActiveCount(): number;
  // Emits: 'tick' (symbol: string, quote: Partial<StockQuote>)
  // Emits: 'volumeAlert' (alert: VolumeAlert)
}

export interface IHistoricalDataProvider {
  requestBars(symbol: string, duration?: string, barSize?: string): Promise<BarData[]>;
}
