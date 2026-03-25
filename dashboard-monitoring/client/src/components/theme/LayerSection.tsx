import type { Layer } from '@/types/theme';
import type { PerformancePeriod } from '@/types/market';
import { StockTable } from '@/components/stock/StockTable';

const ORDER_COLORS: Record<number, string> = {
  1: 'border-blue-500/60',
  2: 'border-emerald-500/50',
  3: 'border-amber-500/40',
  4: 'border-red-500/30',
};

export function LayerSection({
  layer,
  performancePeriod,
}: {
  layer: Layer;
  performancePeriod: PerformancePeriod;
}) {
  const borderColor = ORDER_COLORS[layer.order ?? 1] || 'border-blue-500/50';

  return (
    <section className="mb-6">
      <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 border-l-2 ${borderColor} pl-3`}>
        {layer.name}
      </h2>
      <StockTable stocks={layer.stocks} performancePeriod={performancePeriod} showAggregate />
    </section>
  );
}
