import { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { ThemeView } from '@/components/theme/ThemeView';
import { MacroRegimePanel } from '@/components/macro/MacroRegimePanel';
import { AuxiliaryTabs } from '@/components/common/AuxiliaryTabs';
import { useThemes } from '@/hooks/useThemes';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useMarketData } from '@/hooks/useMarketData';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useThemeStore } from '@/stores/themeStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { generateAllMockQuotes } from '@/lib/mockData';

const WS_URL = `ws://${window.location.hostname}:8080`;

function AppContent() {
  const { send } = useWebSocket(WS_URL);
  useMarketData(send);
  return (
    <>
      <MacroRegimePanel />
      <AuxiliaryTabs />
      <ThemeView />
    </>
  );
}

export default function App() {
  useThemes();

  const themes = useThemeStore((s) => s.themes);
  const connectionStatus = useMarketDataStore((s) => s.connectionStatus);
  const setQuotes = useMarketDataStore((s) => s.setQuotes);
  const loadWatchlist = useWatchlistStore((s) => s.loadFromServer);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  useEffect(() => {
    if (themes.length > 0 && connectionStatus === 'disconnected') {
      const allSymbols = themes.flatMap((t) =>
        t.layers.flatMap((l) => l.stocks.map((s) => s.symbol)),
      );
      const unique = [...new Set(allSymbols)];
      setQuotes(generateAllMockQuotes(unique));
    }
  }, [themes, connectionStatus, setQuotes]);

  return (
    <MainLayout>
      <AppContent />
    </MainLayout>
  );
}
