import { useMarketDataStore } from '@/stores/marketDataStore';
import { cn } from '@/lib/utils';

export function ConnectionBadge() {
  const status = useMarketDataStore((s) => s.connectionStatus);

  const config = {
    connected: { color: 'bg-emerald-500', label: 'Connected' },
    connecting: { color: 'bg-amber-500 animate-pulse', label: 'Connecting...' },
    disconnected: { color: 'bg-red-500', label: 'Disconnected' },
  }[status];

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400">
      <span className={cn('h-2 w-2 rounded-full', config.color)} />
      {config.label}
    </div>
  );
}
