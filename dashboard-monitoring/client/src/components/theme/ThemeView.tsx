import { useMemo } from 'react';
import { useActiveTheme, useThemeStore } from '@/stores/themeStore';
import { ThemeHeader } from './ThemeHeader';
import { LayerSection } from './LayerSection';
import { WatchlistView } from './WatchlistView';
import { PerformanceToggle } from '@/components/stock/PerformanceToggle';
import { VsSpyToggle } from '@/components/stock/VsSpyToggle';
import { ColumnToggle } from '@/components/stock/ColumnToggle';
import { useFilterStore } from '@/stores/filterStore';
import { WATCHLIST_ID } from '@/components/layout/Sidebar';
import type { Layer } from '@/types/theme';

export function ThemeView() {
  const theme = useActiveTheme();
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const period = useFilterStore((s) => s.performancePeriod);
  const setPeriod = useFilterStore((s) => s.setPerformancePeriod);
  const revenueFilter = useFilterStore((s) => s.revenueFilter);

  const filteredLayers: Layer[] = useMemo(() => {
    if (!theme) return [];
    if (revenueFilter === 'all') return theme.layers;

    return theme.layers.map((layer) => ({
      ...layer,
      stocks: layer.stocks.filter((stock) => {
        if (!stock.revenueGeo) return true;
        const val = stock.revenueGeo[revenueFilter] ?? 0;
        return val >= 30;
      }),
    })).filter((layer) => layer.stocks.length > 0);
  }, [theme, revenueFilter]);

  if (activeThemeId === WATCHLIST_ID) {
    return <WatchlistView />;
  }

  if (!theme) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-600">
        <p>Select a theme from the sidebar to get started.</p>
      </div>
    );
  }

  return (
    <div>
      <ThemeHeader theme={theme} />
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <PerformanceToggle active={period} onChange={setPeriod} />
        <VsSpyToggle />
        <ColumnToggle />
      </div>
      {filteredLayers.map((layer) => (
        <LayerSection key={layer.id} layer={layer} performancePeriod={period} />
      ))}
    </div>
  );
}
