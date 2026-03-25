import { useEffect, useRef } from 'react';
import { useActiveTheme, useThemeStore } from '@/stores/themeStore';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { useFilterStore } from '@/stores/filterStore';
import type { ClientMessage } from '@/types/ws';
import type { PerformancePeriod } from '@/types/market';

const WATCHLIST_ID = '__watchlist__';

// Map performance period to historical data request params
function periodToHistorical(period: PerformancePeriod): { duration: string; barSize: string } {
  switch (period) {
    case '1D': return { duration: '5 D', barSize: '5 mins' };
    case '1M': return { duration: '1 M', barSize: '1 day' };
    case '3M': return { duration: '3 M', barSize: '1 day' };
    case '6M': return { duration: '6 M', barSize: '1 day' };
    case 'YTD': return { duration: '1 Y', barSize: '1 day' };
    case '1Y': return { duration: '1 Y', barSize: '1 day' };
    case '2Y': return { duration: '2 Y', barSize: '1 week' };
    case '3Y': return { duration: '3 Y', barSize: '1 week' };
    case '5Y': return { duration: '5 Y', barSize: '1 week' };
    case 'MAX': return { duration: '10 Y', barSize: '1 week' };
  }
}

export function useMarketData(send: (msg: ClientMessage) => void) {
  const activeTheme = useActiveTheme();
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const connectionStatus = useMarketDataStore((s) => s.connectionStatus);
  const watchlistItems = useWatchlistStore((s) => s.items);
  const performancePeriod = useFilterStore((s) => s.performancePeriod);
  const prevSymbolsRef = useRef<string[]>([]);
  const prevPeriodRef = useRef<PerformancePeriod>('1M');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Subscribe/unsubscribe based on active theme or watchlist (#1 fix)
  useEffect(() => {
    if (connectionStatus !== 'connected') return;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      let newSymbols: string[];

      if (activeThemeId === WATCHLIST_ID) {
        // Watchlist mode — subscribe to watchlist symbols
        newSymbols = watchlistItems.map((i) => i.symbol);
      } else if (activeTheme) {
        // Theme mode — subscribe to theme symbols
        newSymbols = activeTheme.layers.flatMap((l) =>
          l.stocks.map((s) => s.symbol),
        );
      } else {
        newSymbols = [];
      }

      const prevSymbols = prevSymbolsRef.current;
      const prevSet = new Set(prevSymbols);
      const newSet = new Set(newSymbols);

      const toUnsub = prevSymbols.filter((s) => !newSet.has(s));
      const toSub = newSymbols.filter((s) => !prevSet.has(s));

      if (toUnsub.length > 0) {
        send({ type: 'UNSUBSCRIBE', symbols: toUnsub });
      }
      if (toSub.length > 0) {
        send({ type: 'SUBSCRIBE', symbols: toSub });
      }

      // Request historical data for new symbols (staggered)
      const { duration, barSize } = periodToHistorical(performancePeriod);
      toSub.forEach((symbol, i) => {
        setTimeout(() => {
          send({ type: 'REQUEST_HISTORICAL', symbol, duration, barSize });
        }, i * 200);
      });

      prevSymbolsRef.current = newSymbols;
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [activeThemeId, activeTheme, connectionStatus, send, watchlistItems, performancePeriod]);

  // Re-request historical data when performance period changes (#7)
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    if (prevPeriodRef.current === performancePeriod) return;
    prevPeriodRef.current = performancePeriod;

    const symbols = prevSymbolsRef.current;
    if (symbols.length === 0) return;

    const { duration, barSize } = periodToHistorical(performancePeriod);
    symbols.forEach((symbol, i) => {
      setTimeout(() => {
        send({ type: 'REQUEST_HISTORICAL', symbol, duration, barSize });
      }, i * 150);
    });
  }, [performancePeriod, connectionStatus, send]);
}
