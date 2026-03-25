import type { StockQuote, BarData, MacroData, VolumeAlert } from './market';

export type ServerMessage =
  | { type: 'QUOTES_UPDATE'; data: Record<string, Partial<StockQuote>> }
  | { type: 'CONNECTION_STATUS'; status: 'connected' | 'disconnected' | 'connecting' }
  | { type: 'HISTORICAL_DATA'; symbol: string; bars: BarData[] }
  | { type: 'MACRO_UPDATE'; data: MacroData }
  | { type: 'VOLUME_ALERT'; alert: VolumeAlert }
  | { type: 'ERROR'; message: string; reqId?: number }
  | { type: 'SUBSCRIPTION_CONFIRMED'; symbols: string[] };

export type ClientMessage =
  | { type: 'SUBSCRIBE'; symbols: string[] }
  | { type: 'UNSUBSCRIBE'; symbols: string[] }
  | { type: 'REQUEST_HISTORICAL'; symbol: string; duration: string; barSize: string };
