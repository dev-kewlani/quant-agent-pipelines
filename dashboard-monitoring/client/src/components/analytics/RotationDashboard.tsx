import { useMemo, useState } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { cn } from '@/lib/utils';
import { iconMap, defaultIcon } from '@/lib/iconMap';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { Theme } from '@/types/theme';
import type { StockQuote } from '@/types/market';

type Frequency = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y';

const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: '1D', label: '1D' },
  { key: '1W', label: '1W' },
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '1Y', label: '1Y' },
];

function getFrequencyValue(quote: Partial<StockQuote>, freq: Frequency): number | null {
  switch (freq) {
    case '1D': return quote.changePercent ?? null;
    case '1W': return null; // No 1W field — approximate from 1M/4
    case '1M': return quote.change1m ?? null;
    case '3M': return quote.change3m ?? null;
    case '6M': return quote.change6m ?? null;
    case '1Y': return quote.change1y ?? null;
  }
}

function computeThemeFrequencyPerf(
  theme: Theme,
  quotes: Record<string, StockQuote>,
  freq: Frequency,
): number | null {
  const values: number[] = [];
  for (const layer of theme.layers) {
    for (const stock of layer.stocks) {
      const q = quotes[stock.symbol];
      if (q) {
        const val = getFrequencyValue(q, freq);
        if (val != null) values.push(val);
      }
    }
  }
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function getCellColor(value: number): string {
  if (value >= 10) return 'bg-emerald-500/80 text-white';
  if (value >= 5) return 'bg-emerald-600/60 text-emerald-100';
  if (value >= 2) return 'bg-emerald-700/40 text-emerald-200';
  if (value >= 0.5) return 'bg-emerald-800/25 text-emerald-300';
  if (value >= -0.5) return 'bg-zinc-800/50 text-zinc-400';
  if (value >= -2) return 'bg-red-800/25 text-red-300';
  if (value >= -5) return 'bg-red-700/40 text-red-200';
  if (value >= -10) return 'bg-red-600/60 text-red-100';
  return 'bg-red-500/80 text-white';
}

function getFlowDirection(
  perf1d: number | null,
  perf1m: number | null,
  perf3m: number | null,
): 'inflow' | 'outflow' | 'accelerating' | 'decelerating' | 'neutral' {
  if (perf1d == null || perf1m == null) return 'neutral';
  // Recent outperforming longer-term = money flowing in (accelerating)
  if (perf1d > 0 && perf1m != null && perf1d > perf1m / 20) return 'accelerating';
  if (perf1d > 0) return 'inflow';
  if (perf1d < 0 && perf1m != null && perf1d < perf1m / 20) return 'decelerating';
  if (perf1d < 0) return 'outflow';
  return 'neutral';
}

interface ThemeRow {
  theme: Theme;
  perfs: Record<Frequency, number | null>;
  flow: 'inflow' | 'outflow' | 'accelerating' | 'decelerating' | 'neutral';
  suppressionAvg: number | null;
  rsAvg: number | null;
}

type SortKey = Frequency | 'name' | 'flow' | 'suppression' | 'rs';

export function RotationDashboard() {
  const themes = useThemeStore((s) => s.themes);
  const quotes = useMarketDataStore((s) => s.quotes);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const [sortKey, setSortKey] = useState<SortKey>('1D');
  const [sortDesc, setSortDesc] = useState(true);

  const rows: ThemeRow[] = useMemo(() => {
    return themes.map((theme) => {
      const perfs: Record<Frequency, number | null> = {} as Record<Frequency, number | null>;
      for (const f of FREQUENCIES) {
        perfs[f.key] = computeThemeFrequencyPerf(theme, quotes, f.key);
      }

      const flow = getFlowDirection(perfs['1D'], perfs['1M'], perfs['3M']);

      // Average suppression score and RS for theme stocks
      let suppressionSum = 0, suppressionCount = 0;
      let rsSum = 0, rsCount = 0;
      for (const layer of theme.layers) {
        for (const stock of layer.stocks) {
          const q = quotes[stock.symbol];
          if (q?.suppressionScore != null) { suppressionSum += q.suppressionScore; suppressionCount++; }
          if (q?.relativeStrength != null) { rsSum += q.relativeStrength; rsCount++; }
        }
      }

      return {
        theme,
        perfs,
        flow,
        suppressionAvg: suppressionCount > 0 ? parseFloat((suppressionSum / suppressionCount).toFixed(2)) : null,
        rsAvg: rsCount > 0 ? parseFloat((rsSum / rsCount).toFixed(3)) : null,
      };
    });
  }, [themes, quotes]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let aVal: number | null = null;
      let bVal: number | null = null;
      if (sortKey === 'name') {
        return sortDesc ? b.theme.name.localeCompare(a.theme.name) : a.theme.name.localeCompare(b.theme.name);
      } else if (sortKey === 'flow') {
        return 0; // No numeric sort for flow
      } else if (sortKey === 'suppression') {
        aVal = a.suppressionAvg;
        bVal = b.suppressionAvg;
      } else if (sortKey === 'rs') {
        aVal = a.rsAvg;
        bVal = b.rsAvg;
      } else {
        aVal = a.perfs[sortKey];
        bVal = b.perfs[sortKey];
      }
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      return sortDesc ? bVal - aVal : aVal - bVal;
    });
    return copy;
  }, [rows, sortKey, sortDesc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
  };

  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            <th
              className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-300 w-[200px]"
              onClick={() => handleSort('name')}
            >
              Theme
            </th>
            {FREQUENCIES.map((f) => (
              <th
                key={f.key}
                className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-300 w-[72px]"
                onClick={() => handleSort(f.key)}
              >
                <div className="flex items-center justify-center gap-0.5">
                  {f.label}
                  {sortKey === f.key && (sortDesc ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
                </div>
              </th>
            ))}
            <th className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 w-[60px]">
              Flow
            </th>
            <th
              className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-300 w-[72px]"
              onClick={() => handleSort('suppression')}
              title="Avg suppression score (negative = suppressed vs trend)"
            >
              <div className="flex items-center justify-center gap-0.5">
                Suppr
                {sortKey === 'suppression' && (sortDesc ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
              </div>
            </th>
            <th
              className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-300 w-[60px]"
              onClick={() => handleSort('rs')}
              title="Relative strength vs SPY"
            >
              <div className="flex items-center justify-center gap-0.5">
                RS
                {sortKey === 'rs' && (sortDesc ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const Icon = iconMap[row.theme.icon] || defaultIcon;
            return (
              <tr
                key={row.theme.id}
                className="border-b border-zinc-800/50 hover:bg-zinc-900/30 cursor-pointer transition-colors"
                onClick={() => setActiveTheme(row.theme.id)}
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    <span className="text-xs text-zinc-300 truncate">{row.theme.name}</span>
                  </div>
                </td>
                {FREQUENCIES.map((f) => {
                  const val = row.perfs[f.key];
                  return (
                    <td key={f.key} className="px-1 py-1">
                      <div className={cn(
                        'text-center text-xs font-mono font-semibold tabular-nums rounded px-1.5 py-1',
                        val != null ? getCellColor(val) : 'text-zinc-700',
                      )}>
                        {val != null ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` : '--'}
                      </div>
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center">
                  <span className={cn(
                    'text-[10px] font-semibold uppercase',
                    row.flow === 'accelerating' ? 'text-emerald-400' :
                    row.flow === 'inflow' ? 'text-emerald-500/70' :
                    row.flow === 'decelerating' ? 'text-red-400' :
                    row.flow === 'outflow' ? 'text-red-500/70' :
                    'text-zinc-600',
                  )}>
                    {row.flow === 'accelerating' ? '++' :
                     row.flow === 'inflow' ? '+' :
                     row.flow === 'decelerating' ? '--' :
                     row.flow === 'outflow' ? '-' : '='}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  {row.suppressionAvg != null ? (
                    <span className={cn(
                      'text-xs font-mono tabular-nums',
                      row.suppressionAvg < -1.5 ? 'text-blue-400 font-semibold' :
                      row.suppressionAvg < -0.5 ? 'text-blue-400/70' :
                      row.suppressionAvg > 1.5 ? 'text-orange-400 font-semibold' :
                      row.suppressionAvg > 0.5 ? 'text-orange-400/70' :
                      'text-zinc-500',
                    )}>
                      {row.suppressionAvg.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-zinc-700 text-xs">--</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {row.rsAvg != null ? (
                    <span className={cn(
                      'text-xs font-mono tabular-nums',
                      row.rsAvg > 1.05 ? 'text-emerald-400' :
                      row.rsAvg < 0.95 ? 'text-red-400' :
                      'text-zinc-500',
                    )}>
                      {row.rsAvg.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-zinc-700 text-xs">--</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
