import { cn } from '@/lib/utils';

export type RevenueRegion = 'all' | 'us' | 'europe' | 'asia' | 'em';

const REGIONS: { label: string; value: RevenueRegion; tooltip: string }[] = [
  { label: 'All', value: 'all', tooltip: 'Show all stocks' },
  { label: 'US-Heavy', value: 'us', tooltip: 'Stocks with >=30% US revenue' },
  { label: 'Europe', value: 'europe', tooltip: 'Stocks with >=30% Europe revenue' },
  { label: 'Asia', value: 'asia', tooltip: 'Stocks with >=30% Asia revenue' },
  { label: 'EM', value: 'em', tooltip: 'Stocks with >=30% Emerging Markets revenue' },
];

export function RevenueFilter({
  active,
  onChange,
}: {
  active: RevenueRegion;
  onChange: (r: RevenueRegion) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
      <span className="px-2 text-xs text-zinc-600">Revenue:</span>
      {REGIONS.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          title={r.tooltip}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
            active === r.value
              ? 'bg-zinc-700 text-zinc-200'
              : 'text-zinc-500 hover:text-zinc-300',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

// Revenue geo tooltip component for individual stocks (#14)
export function RevenueGeoTooltip({ geo }: { geo?: Record<string, number> }) {
  if (!geo || Object.keys(geo).length === 0) return null;

  const labels: Record<string, string> = {
    us: 'US', europe: 'EU', asia: 'Asia', em: 'EM', other: 'Other',
  };

  return (
    <div className="flex items-center gap-1">
      {Object.entries(geo)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([region, pct]) => (
          <span
            key={region}
            className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500"
            title={`${labels[region] || region}: ${pct}%`}
          >
            {labels[region] || region} {pct}%
          </span>
        ))}
    </div>
  );
}
