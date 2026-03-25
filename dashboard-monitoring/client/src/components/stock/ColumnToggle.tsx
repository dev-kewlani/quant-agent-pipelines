import { useState, useRef, useEffect } from 'react';
import { Columns3 } from 'lucide-react';
import { useFilterStore, ALL_COLUMN_DEFS } from '@/stores/filterStore';
import { cn } from '@/lib/utils';

export function ColumnToggle() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleColumns = useFilterStore((s) => s.visibleColumns);
  const toggleColumn = useFilterStore((s) => s.toggleColumn);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Group columns
  const groups = new Map<string, typeof ALL_COLUMN_DEFS>();
  for (const col of ALL_COLUMN_DEFS) {
    if (!groups.has(col.group)) groups.set(col.group, []);
    groups.get(col.group)!.push(col);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border transition-all',
          open
            ? 'bg-zinc-700 border-zinc-600 text-zinc-200'
            : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
        )}
      >
        <Columns3 className="h-3.5 w-3.5" />
        Columns
        <span className="text-[10px] text-zinc-600">{visibleColumns.size}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl z-50 py-1 max-h-80 overflow-y-auto">
          {Array.from(groups.entries()).map(([group, cols]) => (
            <div key={group}>
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600 mt-1">
                {group}
              </div>
              {cols.map((col) => {
                const isVisible = visibleColumns.has(col.id);
                const isRequired = col.id === 'symbol';
                return (
                  <button
                    key={col.id}
                    onClick={() => !isRequired && toggleColumn(col.id)}
                    disabled={isRequired}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1 text-xs transition-colors',
                      isRequired ? 'text-zinc-600 cursor-not-allowed' : 'hover:bg-zinc-800 cursor-pointer',
                      isVisible ? 'text-zinc-200' : 'text-zinc-500',
                    )}
                  >
                    <div className={cn(
                      'h-3 w-3 rounded border flex items-center justify-center shrink-0',
                      isVisible ? 'bg-blue-600 border-blue-500' : 'border-zinc-600',
                    )}>
                      {isVisible && <span className="text-white text-[8px]">&#10003;</span>}
                    </div>
                    {col.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
