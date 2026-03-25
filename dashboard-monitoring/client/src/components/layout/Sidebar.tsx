import { useMemo } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { useMacroStore } from '@/stores/macroStore';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { useFilterStore } from '@/stores/filterStore';
import { cn } from '@/lib/utils';
import { iconMap, defaultIcon } from '@/lib/iconMap';
import { CATEGORY_LABELS, CATEGORY_ORDER, type ThemeCategory, type Theme } from '@/types/theme';
import type { MacroSignal } from '@/types/market';
import { Star, PanelLeftClose, PanelLeft } from 'lucide-react';

const THEME_REGIME_SENSITIVITY: Record<string, number> = {
  'nuclear-energy': 0.5, 'real-assets': -0.5, 'bitcoin-hard-money': 1.2,
  'longevity-bio-ai': 0.3, 'physical-experience': 1.0, 'water': -0.3,
  'skilled-trades': 0.2, 'mental-health': -0.8, 'ai-infrastructure': 1.5,
  'semiconductors': 1.5, 'financials': 1.0, 'fintech': 1.3,
  'b2b-saas': 1.2, 'cybersecurity': 0.5, 'delivery-logistics': 0.6,
  'b2c-consumer': 1.0, 'aerospace-defense': -0.3, 'ev-autonomous': 1.4,
  'clean-energy': 0.8, 'robotics-automation': 1.2, 'robotics-supply-chain': 0.8,
  'grid-deep-infra': 0.2, 'rare-earths-critical': -0.2, 'auth-trust-economy': 0.4,
  'vocational-education': -0.5, 'physical-infra-materials': 0.3,
  'luxury-premium': 1.0, 'emerging-markets': 1.3,
};

function computeRegimeScore(signals: MacroSignal[]): number {
  let score = 0;
  for (const signal of signals) {
    if (signal.regime === 'risk-on') score += 20;
    else if (signal.regime === 'caution') score += 0;
    else score -= 20;
  }
  return Math.max(-100, Math.min(100, score));
}

function getRegimeColor(regimeScore: number, sensitivity: number): string {
  const alignment = regimeScore * sensitivity;
  if (alignment > 30) return 'bg-emerald-500';
  if (alignment > 10) return 'bg-emerald-500/60';
  if (alignment > -10) return 'bg-zinc-600';
  if (alignment > -30) return 'bg-amber-500/60';
  return 'bg-red-500/60';
}

function computeThemeDailyChange(theme: Theme, quotes: Record<string, { changePercent?: number | null }>): number | null {
  const values: number[] = [];
  for (const layer of theme.layers) {
    for (const stock of layer.stocks) {
      const q = quotes[stock.symbol];
      if (q?.changePercent != null) values.push(q.changePercent);
    }
  }
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export const WATCHLIST_ID = '__watchlist__';

export function Sidebar() {
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const macroData = useMacroStore((s) => s.macroData);
  const quotes = useMarketDataStore((s) => s.quotes);
  const watchlistItems = useWatchlistStore((s) => s.items);
  const collapsed = useFilterStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useFilterStore((s) => s.toggleSidebar);

  const regimeScore = useMemo(() => {
    if (!macroData) return 0;
    return computeRegimeScore(macroData.signals);
  }, [macroData]);

  const grouped = useMemo(() => {
    const map = new Map<ThemeCategory, (Theme & { avgChange: number | null })[]>();
    for (const theme of themes) {
      const cat = theme.category || 'thematic';
      if (!map.has(cat)) map.set(cat, []);
      const avgChange = computeThemeDailyChange(theme, quotes);
      map.get(cat)!.push({ ...theme, avgChange });
    }
    for (const [, catThemes] of map) {
      catThemes.sort((a, b) => {
        if (a.avgChange == null && b.avgChange == null) return 0;
        if (a.avgChange == null) return 1;
        if (b.avgChange == null) return -1;
        return b.avgChange - a.avgChange;
      });
    }
    return map;
  }, [themes, quotes]);

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-full flex flex-col border-r border-zinc-800 bg-zinc-950 transition-[width] duration-200 z-30',
        collapsed ? 'w-[60px]' : 'w-[260px]',
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center border-b border-zinc-800 px-3 justify-between">
        {!collapsed && (
          <span className="text-sm font-semibold text-zinc-300 tracking-wide">
            Dashboard
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1">
        {/* Watchlist */}
        <div className="mb-1">
          {!collapsed && (
            <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              Watchlist
            </div>
          )}
          <button
            onClick={() => setActiveTheme(WATCHLIST_ID)}
            title={collapsed ? `Watchlist (${watchlistItems.length})` : undefined}
            className={cn(
              'flex w-full items-center gap-2.5 py-2 text-left transition-colors hover:bg-zinc-900',
              collapsed ? 'justify-center px-0' : 'px-4',
              activeThemeId === WATCHLIST_ID && 'bg-zinc-900 border-l-2 border-amber-500',
              activeThemeId !== WATCHLIST_ID && 'border-l-2 border-transparent',
            )}
          >
            <Star className={cn('h-4 w-4 shrink-0', activeThemeId === WATCHLIST_ID ? 'text-amber-400' : 'text-zinc-600')} />
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-xs font-medium', activeThemeId === WATCHLIST_ID ? 'text-zinc-100' : 'text-zinc-400')}>
                    My Watchlist
                  </div>
                </div>
                <span className="text-[10px] text-zinc-700 tabular-nums">{watchlistItems.length}</span>
              </>
            )}
          </button>
        </div>

        {CATEGORY_ORDER.map((cat) => {
          const catThemes = grouped.get(cat);
          if (!catThemes || catThemes.length === 0) return null;
          return (
            <div key={cat} className="mb-1">
              {!collapsed && (
                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                  {CATEGORY_LABELS[cat]}
                </div>
              )}
              {catThemes.map((theme) => {
                const Icon = iconMap[theme.icon] || defaultIcon;
                const isActive = theme.id === activeThemeId;
                const stockCount = theme.layers.reduce((acc, l) => acc + l.stocks.length, 0);
                const avgChange = theme.avgChange;

                return (
                  <button
                    key={theme.id}
                    onClick={() => setActiveTheme(theme.id)}
                    title={collapsed ? `${theme.name}${avgChange != null ? ` (${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(1)}%)` : ''}` : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 py-2 text-left transition-colors hover:bg-zinc-900',
                      collapsed ? 'justify-center px-0' : 'px-4',
                      isActive && 'bg-zinc-900 border-l-2 border-blue-500',
                      !isActive && 'border-l-2 border-transparent',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-blue-400' : 'text-zinc-600')} />
                    {!collapsed && (
                      <>
                        <div className="min-w-0 flex-1">
                          <div className={cn('truncate text-xs font-medium', isActive ? 'text-zinc-100' : 'text-zinc-400')}>
                            {theme.name}
                          </div>
                        </div>
                        {avgChange != null && (
                          <span className={cn(
                            'text-[10px] font-mono font-semibold tabular-nums shrink-0',
                            avgChange >= 0 ? 'text-emerald-400' : 'text-red-400',
                          )}>
                            {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(1)}%
                          </span>
                        )}
                        {macroData && THEME_REGIME_SENSITIVITY[theme.id] != null && (
                          <div
                            className={cn('h-3 w-1.5 rounded-full shrink-0', getRegimeColor(regimeScore, THEME_REGIME_SENSITIVITY[theme.id]))}
                            title={`Regime alignment: ${(regimeScore * THEME_REGIME_SENSITIVITY[theme.id]).toFixed(0)}`}
                          />
                        )}
                        <span className="text-[10px] text-zinc-700 tabular-nums">{stockCount}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
