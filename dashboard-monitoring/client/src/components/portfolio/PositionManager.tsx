import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { formatPrice, formatVolume } from '@/lib/formatters';
import type { PositionEntry } from '@/types/market';

async function loadPositions(): Promise<PositionEntry[]> {
  try {
    const res = await fetch('/api/portfolio');
    if (res.ok) return await res.json();
  } catch { /* fall through */ }
  return [];
}

async function savePosition(pos: PositionEntry): Promise<void> {
  try {
    await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pos),
    });
  } catch { /* best-effort */ }
}

async function deletePosition(id: string): Promise<void> {
  try {
    await fetch(`/api/portfolio/${id}`, { method: 'DELETE' });
  } catch { /* best-effort */ }
}

export function PositionManager({ alwaysExpanded = false }: { alwaysExpanded?: boolean }) {
  const [positions, setPositions] = useState<PositionEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const quotes = useMarketDataStore((s) => s.quotes);

  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadPositions().then((data) => {
      setPositions(data);
      setLoaded(true);
    });
  }, []);

  const handleAdd = useCallback(() => {
    if (!symbol.trim() || !shares.trim() || !costBasis.trim()) return;
    const pos: PositionEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      symbol: symbol.trim().toUpperCase(),
      shares: parseFloat(shares),
      costBasis: parseFloat(costBasis),
      dateAdded: new Date().toISOString().split('T')[0],
      notes: notes.trim(),
    };
    setPositions((prev) => [...prev, pos]);
    savePosition(pos);
    setSymbol('');
    setShares('');
    setCostBasis('');
    setNotes('');
    setShowForm(false);
  }, [symbol, shares, costBasis, notes]);

  const handleDelete = useCallback((id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
    deletePosition(id);
  }, []);

  if (!loaded) return null;
  if (!alwaysExpanded) return null;

  const enriched = positions.map((pos) => {
    const quote = quotes[pos.symbol];
    const currentPrice = quote?.lastPrice ?? null;
    const marketValue = currentPrice ? currentPrice * pos.shares : null;
    const costValue = pos.costBasis * pos.shares;
    const pnl = marketValue ? marketValue - costValue : null;
    const pnlPct = pnl != null ? (pnl / costValue) * 100 : null;
    return { ...pos, currentPrice, marketValue, costValue, pnl, pnlPct };
  });

  const totalCost = enriched.reduce((s, p) => s + p.costValue, 0);
  const totalMarket = enriched.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const totalPnl = totalMarket - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      {positions.length > 0 && (
        <div className="flex items-center gap-4 text-xs">
          <span className="text-zinc-500">{positions.length} positions</span>
          <span className="font-mono text-zinc-400">MV: {formatPrice(totalMarket)}</span>
          <span className={cn(
            'font-mono font-bold',
            totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
          )}>
            {totalPnl >= 0 ? '+' : ''}{formatPrice(totalPnl)} ({totalPnlPct.toFixed(1)}%)
          </span>
        </div>
      )}

      {/* Positions table */}
      {positions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider">
                <th className="py-1.5 px-2 text-left font-medium">Symbol</th>
                <th className="py-1.5 px-2 text-right font-medium">Shares</th>
                <th className="py-1.5 px-2 text-right font-medium">Cost</th>
                <th className="py-1.5 px-2 text-right font-medium">Current</th>
                <th className="py-1.5 px-2 text-right font-medium">Mkt Value</th>
                <th className="py-1.5 px-2 text-right font-medium">P&L</th>
                <th className="py-1.5 px-2 text-right font-medium">Weight</th>
                <th className="py-1.5 px-2 text-left font-medium">Notes</th>
                <th className="py-1.5 px-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((p) => {
                const weight = totalMarket > 0 && p.marketValue
                  ? (p.marketValue / totalMarket) * 100
                  : null;
                return (
                  <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-1.5 px-2 font-mono font-bold text-blue-400">{p.symbol}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-zinc-300">{formatVolume(p.shares)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-zinc-400">{formatPrice(p.costBasis)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-zinc-200">
                      {p.currentPrice ? formatPrice(p.currentPrice) : '--'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-zinc-300">
                      {p.marketValue ? formatPrice(p.marketValue) : '--'}
                    </td>
                    <td className={cn(
                      'py-1.5 px-2 text-right font-mono font-semibold',
                      p.pnl != null && p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400',
                    )}>
                      {p.pnlPct != null ? `${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%` : '--'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-zinc-500">
                      {weight != null ? `${weight.toFixed(1)}%` : '--'}
                    </td>
                    <td className="py-1.5 px-2 text-zinc-500 max-w-[150px] truncate">{p.notes || '--'}</td>
                    <td className="py-1.5 px-2">
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                        title="Delete position"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      {showForm ? (
        <div className="flex items-center gap-2">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol"
            className="w-20 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 font-mono" />
          <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="Shares" type="number"
            className="w-20 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500" />
          <input value={costBasis} onChange={(e) => setCostBasis(e.target.value)} placeholder="Cost basis" type="number" step="0.01"
            className="w-24 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes"
            className="flex-1 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500" />
          <button onClick={handleAdd}
            disabled={!symbol.trim() || !shares.trim() || !costBasis.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <Plus className="h-3 w-3" /> Add
          </button>
          <button onClick={() => setShowForm(false)} className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
          <Plus className="h-3 w-3" /> Add position
        </button>
      )}

      {positions.length === 0 && !showForm && (
        <p className="text-xs text-zinc-600 text-center py-6">
          No positions yet. Click "Add position" to start tracking.
        </p>
      )}
    </div>
  );
}
