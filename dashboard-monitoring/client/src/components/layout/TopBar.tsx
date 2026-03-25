import { ConnectionBadge } from '@/components/common/ConnectionBadge';
import { SearchBar } from '@/components/common/SearchBar';
import { RevenueFilter } from '@/components/stock/RevenueFilter';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useFilterStore } from '@/stores/filterStore';
import { formatTime } from '@/lib/formatters';
import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

function StaleDataBadge() {
  const lastUpdate = useMarketDataStore((s) => s.lastUpdateTime);
  const connectionStatus = useMarketDataStore((s) => s.connectionStatus);

  if (!lastUpdate) return null;

  const ageMs = Date.now() - lastUpdate;
  const ageSec = Math.floor(ageMs / 1000);
  const isStale = ageSec > 30;

  if (connectionStatus === 'connected' && !isStale) {
    return (
      <span className="text-xs text-zinc-500">
        {formatTime(lastUpdate)}
      </span>
    );
  }

  // Show stale indicator when data is old
  const ageLabel = ageSec < 60 ? `${ageSec}s ago` :
                   ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` :
                   `${Math.floor(ageSec / 3600)}h ago`;

  return (
    <div className={cn(
      'flex items-center gap-1 text-xs',
      isStale ? 'text-amber-400' : 'text-zinc-500',
    )}>
      {isStale && <Clock className="h-3 w-3" />}
      <span>{isStale ? `Cached ${ageLabel}` : formatTime(lastUpdate)}</span>
    </div>
  );
}

export function TopBar() {
  const volumeAlerts = useMarketDataStore((s) => s.volumeAlerts);
  const revenueFilter = useFilterStore((s) => s.revenueFilter);
  const setRevenueFilter = useFilterStore((s) => s.setRevenueFilter);

  const recentAlerts = volumeAlerts.slice(0, 3);

  return (
    <header className="flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-5 gap-4">
      <h1 className="text-base font-semibold text-zinc-100 tracking-tight shrink-0">
        Thematic Dashboard
      </h1>
      <div className="flex items-center gap-3 min-w-0">
        <SearchBar />
        <RevenueFilter active={revenueFilter} onChange={setRevenueFilter} />
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {recentAlerts.length > 0 && (
          <div className="flex items-center gap-1.5" title="Unusual volume detected">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <div className="flex gap-1">
              {recentAlerts.map((a) => (
                <span key={a.symbol + a.timestamp} className="text-[10px] font-mono text-amber-400">
                  {a.symbol} {a.ratio.toFixed(1)}x
                </span>
              ))}
            </div>
          </div>
        )}
        <StaleDataBadge />
        <ConnectionBadge />
      </div>
    </header>
  );
}
