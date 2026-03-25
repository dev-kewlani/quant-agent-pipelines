import { useMemo } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useFilterStore } from '@/stores/filterStore';
import { cn } from '@/lib/utils';
import { iconMap, defaultIcon } from '@/lib/iconMap';
import type { Theme } from '@/types/theme';
import type { PerformancePeriod, StockQuote } from '@/types/market';

function getPeriodValue(quote: Partial<StockQuote>, period: PerformancePeriod): number | null {
  switch (period) {
    case '1D': return quote.changePercent ?? null;
    case '1M': return quote.change1m ?? null;
    case '3M': return quote.change3m ?? null;
    case '6M': return quote.change6m ?? null;
    case 'YTD': return quote.changeYtd ?? null;
    case '1Y': return quote.change1y ?? null;
    case '2Y': return quote.change2y ?? null;
    case '3Y': return quote.change3y ?? null;
    case '5Y': return quote.change5y ?? null;
    case 'MAX': return quote.changeMax ?? null;
  }
}

function computeThemePerf(
  theme: Theme,
  quotes: Record<string, StockQuote>,
  period: PerformancePeriod,
): number | null {
  const values: number[] = [];
  for (const layer of theme.layers) {
    for (const stock of layer.stocks) {
      const q = quotes[stock.symbol];
      if (q) {
        const val = getPeriodValue(q, period);
        if (val != null) values.push(val);
      }
    }
  }
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function getHeatColor(value: number): string {
  if (value >= 5) return 'bg-emerald-500 text-white';
  if (value >= 2) return 'bg-emerald-600/70 text-emerald-100';
  if (value >= 0.5) return 'bg-emerald-700/50 text-emerald-200';
  if (value >= -0.5) return 'bg-zinc-700/50 text-zinc-300';
  if (value >= -2) return 'bg-red-700/50 text-red-200';
  if (value >= -5) return 'bg-red-600/70 text-red-100';
  return 'bg-red-500 text-white';
}

export function ThemeHeatMap({ alwaysExpanded = false }: { alwaysExpanded?: boolean }) {
  const themes = useThemeStore((s) => s.themes);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const quotes = useMarketDataStore((s) => s.quotes);
  const period = useFilterStore((s) => s.performancePeriod);

  const themePerfs = useMemo(() => {
    return themes
      .map((theme) => ({
        theme,
        perf: computeThemePerf(theme, quotes, period),
      }))
      .filter((t) => t.perf != null)
      .sort((a, b) => (b.perf ?? 0) - (a.perf ?? 0));
  }, [themes, quotes, period]);

  if (themePerfs.length === 0) {
    return (
      <div className="text-center py-6 text-zinc-600 text-xs">
        No performance data available yet.
      </div>
    );
  }

  // When used inside AuxiliaryTabs, always show content (no collapse toggle)
  if (!alwaysExpanded) return null;

  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
      {themePerfs.map(({ theme, perf }) => {
        const Icon = iconMap[theme.icon] || defaultIcon;
        return (
          <button
            key={theme.id}
            onClick={() => setActiveTheme(theme.id)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 transition-all hover:ring-1 hover:ring-zinc-600',
              getHeatColor(perf!),
            )}
            title={`${theme.name}: ${perf! >= 0 ? '+' : ''}${perf!.toFixed(2)}%`}
          >
            <Icon className="h-4 w-4 opacity-80" />
            <span className="text-[10px] font-medium leading-tight text-center truncate w-full">
              {theme.name.length > 14 ? theme.name.slice(0, 12) + '...' : theme.name}
            </span>
            <span className="text-xs font-bold font-mono tabular-nums">
              {perf! >= 0 ? '+' : ''}{perf!.toFixed(1)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}
