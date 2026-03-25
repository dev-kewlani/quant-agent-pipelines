import { useFilterStore } from '@/stores/filterStore';
import { cn } from '@/lib/utils';

export function VsSpyToggle() {
  const showVsSpy = useFilterStore((s) => s.showVsSpy);
  const toggleVsSpy = useFilterStore((s) => s.toggleVsSpy);

  return (
    <button
      onClick={toggleVsSpy}
      className={cn(
        'px-3 py-1 text-xs font-medium rounded-lg border transition-all',
        showVsSpy
          ? 'bg-purple-600 border-purple-500 text-white shadow-sm'
          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
      )}
    >
      vs SPY
    </button>
  );
}
