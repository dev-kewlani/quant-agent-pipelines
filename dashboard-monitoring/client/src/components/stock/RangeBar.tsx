import { cn } from '@/lib/utils';

interface RangeBarProps {
  current: number | null | undefined;
  low: number | null | undefined;
  high: number | null | undefined;
}

export function RangeBar({ current, low, high }: RangeBarProps) {
  if (current == null || low == null || high == null || high <= low) {
    return <div className="h-1.5 w-20 rounded-full bg-zinc-800" />;
  }

  const pct = Math.min(Math.max(((current - low) / (high - low)) * 100, 0), 100);

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 rounded-full bg-zinc-800">
        <div
          className={cn(
            'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full',
            pct > 70 ? 'bg-emerald-400' : pct > 30 ? 'bg-amber-400' : 'bg-red-400',
          )}
          style={{ left: `calc(${pct}% - 5px)` }}
        />
      </div>
    </div>
  );
}
