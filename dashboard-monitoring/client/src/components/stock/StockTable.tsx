import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useFilterStore } from '@/stores/filterStore';
import { PriceCell } from './PriceCell';
import { ChangeCell } from './ChangeCell';
import { RangeBar } from './RangeBar';
import { Sparkline } from './Sparkline';
import { formatPrice, formatVolume } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ThemeStock } from '@/types/theme';
import type { StockQuote, PerformancePeriod } from '@/types/market';

interface StockRow extends ThemeStock {
  quote: Partial<StockQuote>;
}

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

function getExcessReturn(
  stockValue: number | null,
  spyQuote: Partial<StockQuote> | null,
  period: PerformancePeriod,
): number | null {
  if (stockValue == null || !spyQuote) return null;
  const spyValue = getPeriodValue(spyQuote, period);
  if (spyValue == null) return null;
  return parseFloat((stockValue - spyValue).toFixed(2));
}

export function StockTable({
  stocks,
  performancePeriod,
  showAggregate = false,
}: {
  stocks: ThemeStock[];
  performancePeriod: PerformancePeriod;
  showAggregate?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const quotes = useMarketDataStore((s) => s.quotes);
  const spyQuote = useMarketDataStore((s) => s.spyQuote);
  const showVsSpy = useFilterStore((s) => s.showVsSpy);
  const visibleColumns = useFilterStore((s) => s.visibleColumns);

  const data: StockRow[] = useMemo(
    () => stocks.map((stock) => ({ ...stock, quote: quotes[stock.symbol] || {} })),
    [stocks, quotes],
  );

  // Compute aggregates
  const aggregates = useMemo(() => {
    if (!showAggregate) return null;
    const perfValues: number[] = [];
    const ivValues: number[] = [];
    let totalVolume = 0;
    const changeValues: number[] = [];
    for (const row of data) {
      const perf = getPeriodValue(row.quote, performancePeriod);
      const displayPerf = showVsSpy ? getExcessReturn(perf, spyQuote, performancePeriod) : perf;
      if (displayPerf != null) perfValues.push(displayPerf);
      if (row.quote.ivPercentile != null) ivValues.push(row.quote.ivPercentile);
      if (row.quote.volume != null) totalVolume += row.quote.volume;
      if (row.quote.changePercent != null) changeValues.push(row.quote.changePercent);
    }
    const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    const median = (a: number[]) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    return {
      avgPerf: avg(perfValues) != null ? parseFloat(avg(perfValues)!.toFixed(2)) : null,
      medianIv: median(ivValues) != null ? Math.round(median(ivValues)!) : null,
      totalVolume,
      avgChange: avg(changeValues) != null ? parseFloat(avg(changeValues)!.toFixed(2)) : null,
      stockCount: data.length,
    };
  }, [data, performancePeriod, showVsSpy, spyQuote, showAggregate]);

  const allColumns: ColumnDef<StockRow>[] = useMemo(
    () => [
      {
        id: 'symbol',
        accessorKey: 'symbol',
        header: 'Symbol',
        size: 80,
        cell: ({ row }) => {
          const isHighVol = (row.original.quote.volumeRatio ?? 0) > 2;
          return (
            <div className="flex items-center gap-1">
              <span className="font-mono font-bold text-sm text-blue-400">{row.original.symbol}</span>
              {isHighVol && <AlertTriangle className="h-3 w-3 text-amber-400" title="Unusual volume" />}
            </div>
          );
        },
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        size: 180,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm text-zinc-300">{row.original.name}</div>
            <div className="truncate text-[10px] text-zinc-600 max-w-[180px]">{row.original.note}</div>
          </div>
        ),
      },
      {
        id: 'lastPrice',
        accessorFn: (row) => row.quote.lastPrice ?? null,
        header: 'Price',
        size: 90,
        cell: ({ row }) => <PriceCell value={row.original.quote.lastPrice} />,
      },
      {
        id: 'change',
        accessorFn: (row) => row.quote.change ?? null,
        header: 'Chg',
        size: 75,
        cell: ({ row }) => <ChangeCell value={row.original.quote.change} />,
      },
      {
        id: 'changePercent',
        accessorFn: (row) => row.quote.changePercent ?? null,
        header: '% Chg',
        size: 75,
        cell: ({ row }) => <ChangeCell value={row.original.quote.changePercent} isPercent />,
      },
      {
        id: 'periodChange',
        accessorFn: (row) => {
          const val = getPeriodValue(row.quote, performancePeriod);
          return showVsSpy ? getExcessReturn(val, spyQuote, performancePeriod) : val;
        },
        header: showVsSpy ? `${performancePeriod} vs SPY` : performancePeriod,
        size: 95,
        cell: ({ row }) => {
          const val = getPeriodValue(row.original.quote, performancePeriod);
          const display = showVsSpy ? getExcessReturn(val, spyQuote, performancePeriod) : val;
          return <ChangeCell value={display} isPercent />;
        },
      },
      // === Analytics columns ===
      {
        id: 'suppressionScore',
        accessorFn: (row) => row.quote.suppressionScore ?? null,
        header: 'Suppr',
        size: 65,
        cell: ({ row }) => {
          const val = row.original.quote.suppressionScore;
          if (val == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          let color = 'text-zinc-400';
          if (val < -1.5) color = 'text-blue-400 font-bold'; // deeply suppressed = opportunity
          else if (val < -0.5) color = 'text-blue-400/80';
          else if (val > 1.5) color = 'text-orange-400 font-bold'; // extended
          else if (val > 0.5) color = 'text-orange-400/80';
          return (
            <span className={cn('font-mono text-xs tabular-nums', color)} title={`Suppression: ${val.toFixed(2)} (negative = below trend)`}>
              {val.toFixed(1)}
            </span>
          );
        },
      },
      {
        id: 'relativeStrength',
        accessorFn: (row) => row.quote.relativeStrength ?? null,
        header: 'RS',
        size: 55,
        cell: ({ row }) => {
          const val = row.original.quote.relativeStrength;
          if (val == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          return (
            <span className={cn(
              'font-mono text-xs tabular-nums',
              val > 1.05 ? 'text-emerald-400' : val < 0.95 ? 'text-red-400' : 'text-zinc-400',
            )}>
              {val.toFixed(2)}
            </span>
          );
        },
      },
      {
        id: 'momentum',
        accessorFn: (row) => row.quote.momentum ?? null,
        header: 'Mom',
        size: 60,
        cell: ({ row }) => {
          const val = row.original.quote.momentum;
          if (val == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          return (
            <span className={cn(
              'font-mono text-xs tabular-nums',
              val > 5 ? 'text-emerald-400' : val < -5 ? 'text-red-400' : 'text-zinc-400',
            )}>
              {val >= 0 ? '+' : ''}{val.toFixed(1)}
            </span>
          );
        },
      },
      {
        id: 'beta',
        accessorFn: (row) => row.quote.beta ?? null,
        header: 'Beta',
        size: 55,
        cell: ({ row }) => {
          const val = row.original.quote.beta;
          if (val == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          return (
            <span className={cn(
              'font-mono text-xs tabular-nums',
              val > 1.3 ? 'text-orange-400' : val < 0.7 ? 'text-blue-400' : 'text-zinc-400',
            )}>
              {val.toFixed(2)}
            </span>
          );
        },
      },
      // === Analyst columns ===
      {
        id: 'analystRating',
        accessorFn: (row) => row.quote.analystRating ?? null,
        header: 'Rating',
        size: 70,
        cell: ({ row }) => {
          const rating = row.original.quote.analystRating;
          const count = row.original.quote.analystCount;
          if (rating == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          const labels = ['', 'Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'];
          const colors = ['', 'text-emerald-400', 'text-emerald-400/70', 'text-zinc-400', 'text-red-400/70', 'text-red-400'];
          const idx = Math.round(rating);
          return (
            <div className="flex flex-col">
              <span className={cn('text-[10px] font-semibold', colors[idx] || 'text-zinc-400')}>
                {labels[idx] || rating.toFixed(1)}
              </span>
              {count != null && <span className="text-[9px] text-zinc-600">{count} analysts</span>}
            </div>
          );
        },
      },
      {
        id: 'analystTarget',
        accessorFn: (row) => row.quote.upsidePercent ?? null,
        header: 'Target',
        size: 80,
        cell: ({ row }) => {
          const target = row.original.quote.analystTarget;
          const upside = row.original.quote.upsidePercent;
          if (target == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          return (
            <div className="flex flex-col">
              <span className="font-mono text-xs text-zinc-300">${target.toFixed(0)}</span>
              {upside != null && (
                <span className={cn(
                  'text-[10px] font-mono font-semibold',
                  upside > 0 ? 'text-emerald-400' : 'text-red-400',
                )}>
                  {upside > 0 ? '+' : ''}{upside.toFixed(0)}%
                </span>
              )}
            </div>
          );
        },
      },
      // === Volatility columns ===
      {
        id: 'ivPercentile',
        accessorFn: (row) => row.quote.ivPercentile ?? null,
        header: 'IV %ile',
        size: 70,
        cell: ({ row }) => {
          const val = row.original.quote.ivPercentile;
          if (val == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          let color = 'text-zinc-400';
          if (val < 25) color = 'text-blue-400';
          else if (val > 75) color = 'text-orange-400';
          return <span className={cn('font-mono text-xs font-semibold tabular-nums', color)}>{val}%</span>;
        },
      },
      {
        id: 'ivRank',
        accessorFn: (row) => row.quote.ivRank ?? null,
        header: 'IV Rank',
        size: 70,
        cell: ({ row }) => {
          const val = row.original.quote.ivRank;
          if (val == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          let color = 'text-zinc-400';
          if (val < 25) color = 'text-blue-400';
          else if (val > 75) color = 'text-orange-400';
          return <span className={cn('font-mono text-xs font-semibold tabular-nums', color)}>{val}%</span>;
        },
      },
      {
        id: 'ivHvRatio',
        accessorFn: (row) => row.quote.ivHvRatio ?? null,
        header: 'IV/HV',
        size: 65,
        cell: ({ row }) => {
          const val = row.original.quote.ivHvRatio;
          if (val == null) return <span className="font-mono text-xs text-zinc-700">--</span>;
          let color = 'text-zinc-400';
          if (val > 1.5) color = 'text-orange-400';
          else if (val < 0.8) color = 'text-blue-400';
          return <span className={cn('font-mono text-xs font-semibold tabular-nums', color)}>{val.toFixed(2)}</span>;
        },
      },
      {
        id: 'high52w',
        accessorFn: (row) => row.quote.high52w ?? null,
        header: '52W Hi',
        size: 85,
        cell: ({ row }) => <span className="font-mono text-xs tabular-nums text-zinc-500">{formatPrice(row.original.quote.high52w)}</span>,
      },
      {
        id: 'low52w',
        accessorFn: (row) => row.quote.low52w ?? null,
        header: '52W Lo',
        size: 85,
        cell: ({ row }) => <span className="font-mono text-xs tabular-nums text-zinc-500">{formatPrice(row.original.quote.low52w)}</span>,
      },
      {
        id: 'range',
        header: 'Range',
        size: 80,
        enableSorting: false,
        cell: ({ row }) => (
          <RangeBar current={row.original.quote.lastPrice} low={row.original.quote.low52w} high={row.original.quote.high52w} />
        ),
      },
      {
        id: 'volume',
        accessorFn: (row) => row.quote.volume ?? null,
        header: 'Vol',
        size: 70,
        cell: ({ row }) => {
          const ratio = row.original.quote.volumeRatio;
          const isHigh = (ratio ?? 0) > 2;
          return (
            <span className={cn('font-mono text-xs', isHigh ? 'text-amber-400 font-semibold' : 'text-zinc-500')}>
              {formatVolume(row.original.quote.volume)}
              {isHigh && ratio != null && <span className="text-[10px] ml-0.5">({ratio.toFixed(1)}x)</span>}
            </span>
          );
        },
      },
      {
        id: 'sparkline',
        header: '30D',
        size: 120,
        enableSorting: false,
        cell: ({ row }) => <Sparkline symbol={row.original.symbol} />,
      },
    ],
    [performancePeriod, showVsSpy, spyQuote],
  );

  // Filter columns based on visibility
  const columns = useMemo(
    () => allColumns.filter((col) => {
      const id = col.id ?? (col as { accessorKey?: string }).accessorKey ?? '';
      return visibleColumns.has(id);
    }),
    [allColumns, visibleColumns],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleColCount = columns.length;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-zinc-800 bg-zinc-900/50">
              {hg.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={cn(
                      'px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500',
                      header.column.getCanSort() && 'cursor-pointer select-none hover:text-zinc-300',
                    )}
                    style={{ width: header.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="text-zinc-600">
                          {sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> :
                           sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> :
                           <ArrowUpDown className="h-3 w-3" />}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {showAggregate && aggregates && (
            <tr className="border-b border-zinc-700 bg-zinc-900/80">
              {columns.map((col) => {
                const id = col.id ?? '';
                return (
                  <td key={id} className="px-2.5 py-1.5 text-xs">
                    {id === 'symbol' && <span className="text-zinc-500 font-semibold">AVG</span>}
                    {id === 'name' && <span className="text-zinc-600">{aggregates.stockCount} stocks</span>}
                    {id === 'changePercent' && <ChangeCell value={aggregates.avgChange} isPercent />}
                    {id === 'periodChange' && <ChangeCell value={aggregates.avgPerf} isPercent />}
                    {id === 'ivPercentile' && aggregates.medianIv != null && (
                      <span className="font-mono text-xs text-zinc-400">{aggregates.medianIv}%</span>
                    )}
                    {id === 'volume' && (
                      <span className="font-mono text-xs text-zinc-400">{formatVolume(aggregates.totalVolume)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          )}
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-900/30">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-2.5 py-1.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
