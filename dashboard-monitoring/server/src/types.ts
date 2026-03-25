export interface StockQuote {
  symbol: string;
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  high52w: number | null;
  low52w: number | null;
  change1m: number | null;
  change3m: number | null;
  change6m: number | null;
  changeYtd: number | null;
  change1y: number | null;
  change2y: number | null;
  change3y: number | null;
  change5y: number | null;
  changeMax: number | null;
  ivPercentile: number | null;
  ivRank: number | null;
  realizedVol: number | null;
  ivHvRatio: number | null;
  volumeAvg20d: number | null;
  volumeRatio: number | null;
  // Analytics
  analystRating: number | null;      // 1=Strong Buy ... 5=Strong Sell
  analystTarget: number | null;      // Consensus target price
  analystCount: number | null;       // Number of analysts
  upsidePercent: number | null;      // % upside to target
  suppressionScore: number | null;   // z-score: how suppressed vs long-term trend (negative = suppressed)
  relativeStrength: number | null;   // RS ratio vs SPY for selected period (>1 = outperforming)
  momentum: number | null;           // Rate of change score (positive = accelerating)
  beta: number | null;               // Rolling beta to SPY
  lastUpdate: number;
}

export interface MacroSignal {
  name: string;
  value: number;
  label: string;
  regime: 'risk-on' | 'caution' | 'risk-off';
  zScore: number | null;
  trend: 'rising' | 'falling' | 'flat';
  rateOfChange: number | null;
}

export interface BreadthData {
  rspSpyRatio: number | null;
  rspSpyRatioZScore: number | null;
  rspSpyTrend: 'rising' | 'falling' | 'flat';
  label: string;
  regime: 'risk-on' | 'caution' | 'risk-off';
}

export interface MacroIndicator {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
  category: 'rate' | 'commodity' | 'currency' | 'crypto' | 'index' | 'volatility';
}

export interface MacroData {
  signals: MacroSignal[];
  breadth: BreadthData | null;
  indicators: MacroIndicator[];
  vix: number | null;
  lastUpdate: number;
}

export interface VolumeAlert {
  symbol: string;
  currentVolume: number;
  avgVolume: number;
  ratio: number;
  timestamp: number;
}

export interface BarData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EventDate {
  name: string;
  date: string;
  type: 'fomc' | 'cpi' | 'nfp' | 'gdp' | 'earnings' | 'other';
}

export interface PredictionEntry {
  id: string;
  date: string;
  thesis: string;
  instrument: string;
  direction: 'long' | 'short';
  magnitude: string;
  timeframe: string;
  outcome: 'pending' | 'correct' | 'wrong' | 'partial';
  notes: string;
  entryPrice: number | null;
  entryIvPercentile: number | null;
  entryMacroRegime: string | null;
  exitPrice: number | null;
  exitDate: string | null;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  addedAt: number;
}

export interface PositionEntry {
  id: string;
  symbol: string;
  shares: number;
  costBasis: number;
  dateAdded: string;
  notes: string;
}

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

export interface ThemeStock {
  symbol: string;
  name: string;
  note: string;
}

export interface Layer {
  id: string;
  name: string;
  stocks: ThemeStock[];
}

export interface Theme {
  id: string;
  name: string;
  thesis: string;
  icon: string;
  layers: Layer[];
}
