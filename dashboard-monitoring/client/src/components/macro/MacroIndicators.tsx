import { useMacroStore } from '@/stores/macroStore';
import { cn } from '@/lib/utils';
import type { MacroIndicator } from '@/types/market';

const CATEGORY_LABELS: Record<string, string> = {
  rate: 'Rates',
  commodity: 'Commodities',
  currency: 'Currencies',
  crypto: 'Crypto',
  index: 'Indices',
  volatility: 'Volatility',
};

const CATEGORY_ORDER = ['index', 'rate', 'currency', 'commodity', 'crypto', 'volatility'];

function IndicatorChip({ indicator }: { indicator: MacroIndicator }) {
  const isPositive = indicator.changePercent >= 0;

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-800/50 border border-zinc-800 min-w-[130px]">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-zinc-500 truncate">{indicator.name}</div>
        <div className="text-xs font-mono font-semibold text-zinc-200 tabular-nums">
          {indicator.category === 'rate'
            ? `${indicator.value.toFixed(2)}%`
            : indicator.value >= 1000
              ? indicator.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
              : indicator.value.toFixed(2)}
        </div>
      </div>
      <div className={cn(
        'text-[10px] font-mono font-semibold tabular-nums whitespace-nowrap',
        isPositive ? 'text-emerald-400' : 'text-red-400',
      )}>
        {isPositive ? '+' : ''}{indicator.changePercent.toFixed(2)}%
      </div>
    </div>
  );
}

export function MacroIndicators() {
  const macroData = useMacroStore((s) => s.macroData);

  if (!macroData?.indicators || macroData.indicators.length === 0) return null;

  // Group by category
  const grouped = new Map<string, MacroIndicator[]>();
  for (const ind of macroData.indicators) {
    if (!grouped.has(ind.category)) grouped.set(ind.category, []);
    grouped.get(ind.category)!.push(ind);
  }

  return (
    <div className="space-y-2">
      {CATEGORY_ORDER.map((cat) => {
        const indicators = grouped.get(cat);
        if (!indicators || indicators.length === 0) return null;
        return (
          <div key={cat}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1">
              {CATEGORY_LABELS[cat] || cat}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {indicators.map((ind) => (
                <IndicatorChip key={ind.symbol} indicator={ind} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
