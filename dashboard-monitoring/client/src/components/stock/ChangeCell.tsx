import { cn } from '@/lib/utils';

export function ChangeCell({
  value,
  isPercent = false,
}: {
  value: number | null | undefined;
  isPercent?: boolean;
}) {
  if (value == null) {
    return <span className="font-mono text-sm text-zinc-600">--</span>;
  }

  const isPositive = value >= 0;
  const prefix = isPositive ? '+' : '';
  const display = isPercent
    ? `${prefix}${value.toFixed(2)}%`
    : `${prefix}${value.toFixed(2)}`;

  return (
    <span
      className={cn(
        'font-mono text-sm tabular-nums font-medium',
        isPositive ? 'text-emerald-400' : 'text-red-400',
      )}
    >
      {display}
    </span>
  );
}
