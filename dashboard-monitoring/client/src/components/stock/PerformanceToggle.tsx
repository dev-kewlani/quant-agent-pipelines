import { cn } from '@/lib/utils';
import type { PerformancePeriod } from '@/types/market';

const PERIODS: { label: string; value: PerformancePeriod }[] = [
  { label: '1D', value: '1D' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: 'YTD', value: 'YTD' },
  { label: '1Y', value: '1Y' },
  { label: '2Y', value: '2Y' },
  { label: '3Y', value: '3Y' },
  { label: '5Y', value: '5Y' },
  { label: 'MAX', value: 'MAX' },
];

export function PerformanceToggle({
  active,
  onChange,
}: {
  active: PerformancePeriod;
  onChange: (p: PerformancePeriod) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md transition-all',
            active === p.value
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
