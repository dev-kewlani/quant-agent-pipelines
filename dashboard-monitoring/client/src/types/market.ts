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
  analystRating: number | null;
  analystTarget: number | null;
  analystCount: number | null;
  upsidePercent: number | null;
  suppressionScore: number | null;
  relativeStrength: number | null;
  momentum: number | null;
  beta: number | null;
  lastUpdate: number;
}

export type PerformancePeriod = '1D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '2Y' | '3Y' | '5Y' | 'MAX';

export interface BarData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

export interface PositionEntry {
  id: string;
  symbol: string;
  shares: number;
  costBasis: number;
  dateAdded: string;
  notes: string;
}
