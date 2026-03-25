import { create } from 'zustand';
import type { StockQuote, BarData, VolumeAlert } from '@/types/market';

interface MarketDataState {
  quotes: Record<string, StockQuote>;
  historicalData: Record<string, BarData[]>;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastUpdateTime: number | null;
  volumeAlerts: VolumeAlert[];
  spyQuote: Partial<StockQuote> | null;

  updateQuotes: (updates: Record<string, Partial<StockQuote>>) => void;
  setQuotes: (quotes: Record<string, StockQuote>) => void;
  setHistoricalData: (symbol: string, bars: BarData[]) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'connecting') => void;
  addVolumeAlert: (alert: VolumeAlert) => void;
  clearVolumeAlerts: () => void;
}

const MAX_ALERTS = 50;

export const useMarketDataStore = create<MarketDataState>((set) => ({
  quotes: {},
  historicalData: {},
  connectionStatus: 'disconnected',
  lastUpdateTime: null,
  volumeAlerts: [],
  spyQuote: null,

  updateQuotes: (updates) =>
    set((state) => {
      const newQuotes = { ...state.quotes };
      let spyQuote = state.spyQuote;
      for (const [symbol, update] of Object.entries(updates)) {
        newQuotes[symbol] = { ...newQuotes[symbol], ...update, symbol } as StockQuote;
        if (symbol === 'SPY') {
          spyQuote = newQuotes[symbol];
        }
      }
      return { quotes: newQuotes, lastUpdateTime: Date.now(), spyQuote };
    }),

  setQuotes: (quotes) =>
    set({
      quotes,
      lastUpdateTime: Date.now(),
      spyQuote: quotes['SPY'] || null,
    }),

  setHistoricalData: (symbol, bars) =>
    set((state) => ({
      historicalData: { ...state.historicalData, [symbol]: bars },
    })),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  addVolumeAlert: (alert) =>
    set((state) => ({
      volumeAlerts: [alert, ...state.volumeAlerts].slice(0, MAX_ALERTS),
    })),

  clearVolumeAlerts: () => set({ volumeAlerts: [] }),
}));
