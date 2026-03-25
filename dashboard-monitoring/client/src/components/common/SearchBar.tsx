import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Plus, Check, X } from 'lucide-react';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { cn } from '@/lib/utils';

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
}

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const addItem = useWatchlistStore((s) => s.addItem);
  const items = useWatchlistStore((s) => s.items);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data: SearchResult[] = await res.json();
      setResults(data);
      setIsOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (value.trim().length === 0) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => search(value.trim()), 250);
  };

  const handleAdd = (result: SearchResult) => {
    addItem(result.symbol, result.name);
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Ctrl+K or /
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && document.activeElement === document.body)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const watchlistSymbols = new Set(items.map((i) => i.symbol));

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 focus-within:border-blue-500 transition-colors">
        <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search stocks... (Ctrl+K)"
          className="bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none w-48"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setIsOpen(false); }}
            className="text-zinc-600 hover:text-zinc-400"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-96 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl z-50 max-h-80 overflow-y-auto">
          {results.map((r) => {
            const inWatchlist = watchlistSymbols.has(r.symbol);
            return (
              <div
                key={r.symbol}
                className="flex items-center justify-between px-3 py-2 hover:bg-zinc-800/50 border-b border-zinc-800/50 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-400">{r.symbol}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                      {r.type}
                    </span>
                    <span className="text-[10px] text-zinc-600">{r.exchange}</span>
                  </div>
                  <div className="text-xs text-zinc-400 truncate">{r.name}</div>
                </div>
                <button
                  onClick={() => handleAdd(r)}
                  disabled={inWatchlist}
                  className={cn(
                    'ml-2 shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
                    inWatchlist
                      ? 'text-emerald-400 bg-emerald-500/10 cursor-default'
                      : 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 cursor-pointer',
                  )}
                >
                  {inWatchlist ? (
                    <><Check className="h-3 w-3" /> Added</>
                  ) : (
                    <><Plus className="h-3 w-3" /> Watchlist</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isOpen && loading && results.length === 0 && (
        <div className="absolute top-full left-0 mt-1 w-96 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl z-50 px-3 py-4 text-xs text-zinc-500 text-center">
          Searching...
        </div>
      )}

      {isOpen && !loading && query.length > 0 && results.length === 0 && (
        <div className="absolute top-full left-0 mt-1 w-96 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl z-50 px-3 py-4 text-xs text-zinc-500 text-center">
          No results found
        </div>
      )}
    </div>
  );
}
