import { useMemo } from 'react';
import { Star, Trash2 } from 'lucide-react';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { useFilterStore } from '@/stores/filterStore';
import { PerformanceToggle } from '@/components/stock/PerformanceToggle';
import { StockTable } from '@/components/stock/StockTable';
import type { ThemeStock } from '@/types/theme';

export function WatchlistView() {
  const items = useWatchlistStore((s) => s.items);
  const removeItem = useWatchlistStore((s) => s.removeItem);
  const period = useFilterStore((s) => s.performancePeriod);
  const setPeriod = useFilterStore((s) => s.setPerformancePeriod);

  const stocks: ThemeStock[] = useMemo(
    () => items.map((i) => ({ symbol: i.symbol, name: i.name, note: '' })),
    [items],
  );

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Star className="h-6 w-6 text-amber-400" />
          <h2 className="text-2xl font-bold text-zinc-100">My Watchlist</h2>
          <span className="text-sm text-zinc-500">{items.length} stocks</span>
        </div>
        <p className="text-sm text-zinc-500">
          Stocks added from the search bar. Use Ctrl+K to search and add stocks.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <PerformanceToggle active={period} onChange={setPeriod} />
      </div>

      {items.length > 0 ? (
        <div className="space-y-4">
          <StockTable stocks={stocks} performancePeriod={period} />
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <button
                key={item.symbol}
                onClick={() => removeItem(item.symbol)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-400 hover:text-red-400 hover:bg-zinc-700 transition-colors group"
              >
                <span className="font-mono font-medium">{item.symbol}</span>
                <Trash2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-16 text-zinc-600">
          <Star className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm mb-2">Your watchlist is empty</p>
          <p className="text-xs">
            Use the search bar (Ctrl+K) to find and add stocks
          </p>
        </div>
      )}
    </div>
  );
}
