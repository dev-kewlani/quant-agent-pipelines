import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useMacroStore } from '@/stores/macroStore';
import type { PredictionEntry } from '@/types/market';

const OUTCOME_COLORS = {
  pending: 'text-zinc-400 bg-zinc-800',
  correct: 'text-emerald-400 bg-emerald-500/15',
  wrong: 'text-red-400 bg-red-500/15',
  partial: 'text-amber-400 bg-amber-500/15',
};

async function loadFromServer(): Promise<PredictionEntry[]> {
  try {
    const res = await fetch('/api/predictions');
    if (res.ok) return await res.json();
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem('dashboard-predictions');
    if (raw) {
      const old = JSON.parse(raw) as Array<Record<string, unknown>>;
      return old.map((p) => ({
        id: (p.id as string) || '',
        date: (p.date as string) || '',
        thesis: (p.thesis as string) || '',
        instrument: (p.instrument as string) || '',
        direction: (p.direction as 'long' | 'short') || 'long',
        magnitude: (p.magnitude as string) || '',
        timeframe: (p.timeframe as string) || '',
        outcome: (p.outcome as PredictionEntry['outcome']) || 'pending',
        notes: (p.notes as string) || '',
        entryPrice: (p.entryPrice as number) ?? null,
        entryIvPercentile: (p.entryIvPercentile as number) ?? null,
        entryMacroRegime: (p.entryMacroRegime as string) ?? null,
        exitPrice: (p.exitPrice as number) ?? null,
        exitDate: (p.exitDate as string) ?? null,
      }));
    }
  } catch { /* ignore */ }
  return [];
}

async function saveToServer(prediction: PredictionEntry): Promise<void> {
  try {
    await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prediction),
    });
  } catch { /* best-effort */ }
}

async function updateOnServer(id: string, updates: Partial<PredictionEntry>): Promise<void> {
  try {
    await fetch(`/api/predictions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  } catch { /* best-effort */ }
}

async function deleteOnServer(id: string): Promise<void> {
  try {
    await fetch(`/api/predictions/${id}`, { method: 'DELETE' });
  } catch { /* best-effort */ }
}

function QuickAddForm({ onAdd }: { onAdd: (p: PredictionEntry) => void }) {
  const [thesis, setThesis] = useState('');
  const [instrument, setInstrument] = useState('');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [showMore, setShowMore] = useState(false);
  const [magnitude, setMagnitude] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const quotes = useMarketDataStore((s) => s.quotes);
  const macroData = useMacroStore((s) => s.macroData);

  const handleSubmit = () => {
    if (!thesis.trim() || !instrument.trim()) return;

    const symbol = instrument.trim().toUpperCase();
    const quote = quotes[symbol];

    let macroRegime: string | null = null;
    if (macroData) {
      const counts = { 'risk-on': 0, caution: 0, 'risk-off': 0 };
      for (const s of macroData.signals) counts[s.regime]++;
      if (counts['risk-on'] >= 3) macroRegime = 'risk-on';
      else if (counts['risk-off'] >= 3) macroRegime = 'risk-off';
      else macroRegime = 'caution';
    }

    const prediction: PredictionEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: new Date().toISOString().split('T')[0],
      thesis: thesis.trim(),
      instrument: symbol,
      direction,
      magnitude: magnitude.trim(),
      timeframe: timeframe.trim(),
      outcome: 'pending',
      notes: '',
      entryPrice: quote?.lastPrice ?? null,
      entryIvPercentile: quote?.ivPercentile ?? null,
      entryMacroRegime: macroRegime,
      exitPrice: null,
      exitDate: null,
    };
    onAdd(prediction);
    setThesis('');
    setInstrument('');
    setMagnitude('');
    setTimeframe('');
    setShowMore(false);
  };

  return (
    <div className="space-y-2">
      {/* Quick capture row: the essentials */}
      <div className="flex items-center gap-2">
        <input
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          placeholder="Ticker"
          className="w-20 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
        />
        <div className="flex rounded overflow-hidden border border-zinc-700">
          <button
            onClick={() => setDirection('long')}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors',
              direction === 'long'
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
          >
            Long
          </button>
          <button
            onClick={() => setDirection('short')}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors',
              direction === 'short'
                ? 'bg-red-600 text-white'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
          >
            Short
          </button>
        </div>
        <input
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          placeholder="Thesis — why this trade?"
          className="flex-1 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <button
          onClick={() => setShowMore(!showMore)}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors whitespace-nowrap"
        >
          {showMore ? 'Less' : '+Details'}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!thesis.trim() || !instrument.trim()}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="h-3 w-3" />
          Log
        </button>
      </div>

      {/* Optional details row */}
      {showMore && (
        <div className="flex items-center gap-2 pl-[88px]">
          <input
            value={magnitude}
            onChange={(e) => setMagnitude(e.target.value)}
            placeholder="Magnitude (e.g. +20%)"
            className="w-36 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
          />
          <input
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            placeholder="Timeframe (e.g. 3 months)"
            className="w-40 px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}
    </div>
  );
}

export function PredictionLog({ alwaysExpanded = false }: { alwaysExpanded?: boolean }) {
  const [predictions, setPredictions] = useState<PredictionEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const quotes = useMarketDataStore((s) => s.quotes);

  useEffect(() => {
    loadFromServer().then((data) => {
      setPredictions(data);
      setLoaded(true);
    });
  }, []);

  const addPrediction = useCallback((p: PredictionEntry) => {
    setPredictions((prev) => [p, ...prev]);
    saveToServer(p);
  }, []);

  const updateOutcome = useCallback((id: string, outcome: PredictionEntry['outcome']) => {
    setPredictions((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const updates: Partial<PredictionEntry> = { outcome };
        if (outcome !== 'pending' && p.exitPrice == null) {
          const quote = quotes[p.instrument];
          updates.exitPrice = quote?.lastPrice ?? null;
          updates.exitDate = new Date().toISOString().split('T')[0];
        }
        const updated = { ...p, ...updates };
        updateOnServer(id, updates);
        return updated;
      }),
    );
  }, [quotes]);

  const deletePrediction = useCallback((id: string) => {
    setPredictions((prev) => prev.filter((p) => p.id !== id));
    deleteOnServer(id);
  }, []);

  const stats = {
    total: predictions.length,
    correct: predictions.filter((p) => p.outcome === 'correct').length,
    wrong: predictions.filter((p) => p.outcome === 'wrong').length,
    pending: predictions.filter((p) => p.outcome === 'pending').length,
  };
  const hitRate = stats.total - stats.pending > 0
    ? Math.round((stats.correct / (stats.correct + stats.wrong)) * 100)
    : null;

  if (!loaded) return null;

  // When used inside AuxiliaryTabs, always show content
  const showContent = alwaysExpanded;
  if (!showContent && !alwaysExpanded) return null;

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      {stats.total > 0 && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">{stats.total} predictions</span>
          <span className="text-emerald-400 font-medium">{stats.correct}W</span>
          <span className="text-red-400 font-medium">{stats.wrong}L</span>
          <span className="text-zinc-500">{stats.pending} pending</span>
          {hitRate != null && (
            <span className={cn(
              'font-bold',
              hitRate >= 60 ? 'text-emerald-400' : hitRate >= 40 ? 'text-amber-400' : 'text-red-400',
            )}>
              {hitRate}% hit rate
            </span>
          )}
        </div>
      )}

      {/* Quick-add form */}
      <QuickAddForm onAdd={addPrediction} />

      {/* Predictions table */}
      {predictions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider">
                <th className="py-1.5 px-2 text-left font-medium">Date</th>
                <th className="py-1.5 px-2 text-left font-medium">Thesis</th>
                <th className="py-1.5 px-2 text-left font-medium">Ticker</th>
                <th className="py-1.5 px-2 text-left font-medium">Dir</th>
                <th className="py-1.5 px-2 text-left font-medium">Entry</th>
                <th className="py-1.5 px-2 text-left font-medium">Exit</th>
                <th className="py-1.5 px-2 text-left font-medium">IV%</th>
                <th className="py-1.5 px-2 text-left font-medium">Regime</th>
                <th className="py-1.5 px-2 text-left font-medium">Outcome</th>
                <th className="py-1.5 px-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p) => {
                let pnl: number | null = null;
                if (p.entryPrice && p.exitPrice) {
                  const rawPnl = p.direction === 'long'
                    ? ((p.exitPrice - p.entryPrice) / p.entryPrice) * 100
                    : ((p.entryPrice - p.exitPrice) / p.entryPrice) * 100;
                  pnl = parseFloat(rawPnl.toFixed(2));
                }

                return (
                  <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-1.5 px-2 font-mono text-zinc-500">{p.date}</td>
                    <td className="py-1.5 px-2 text-zinc-300 max-w-[250px] truncate">{p.thesis}</td>
                    <td className="py-1.5 px-2 font-mono font-bold text-blue-400">{p.instrument}</td>
                    <td className="py-1.5 px-2">
                      <span className={p.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                        {p.direction === 'long' ? 'LONG' : 'SHORT'}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-mono text-zinc-400">
                      {p.entryPrice != null ? `$${p.entryPrice.toFixed(2)}` : '--'}
                    </td>
                    <td className="py-1.5 px-2">
                      {p.exitPrice != null ? (
                        <div>
                          <span className="font-mono text-zinc-400">${p.exitPrice.toFixed(2)}</span>
                          {pnl != null && (
                            <span className={cn(
                              'ml-1 font-mono text-[10px]',
                              pnl >= 0 ? 'text-emerald-400' : 'text-red-400',
                            )}>
                              {pnl >= 0 ? '+' : ''}{pnl}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-600">--</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-zinc-500">
                      {p.entryIvPercentile != null ? `${p.entryIvPercentile}%` : '--'}
                    </td>
                    <td className="py-1.5 px-2">
                      {p.entryMacroRegime && (
                        <span className={cn(
                          'text-[10px] font-semibold uppercase',
                          p.entryMacroRegime === 'risk-on' ? 'text-emerald-400' :
                          p.entryMacroRegime === 'risk-off' ? 'text-red-400' : 'text-amber-400',
                        )}>
                          {p.entryMacroRegime}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2">
                      <select
                        value={p.outcome}
                        onChange={(e) => updateOutcome(p.id, e.target.value as PredictionEntry['outcome'])}
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500',
                          OUTCOME_COLORS[p.outcome],
                        )}
                      >
                        <option value="pending">Pending</option>
                        <option value="correct">Correct</option>
                        <option value="wrong">Wrong</option>
                        <option value="partial">Partial</option>
                      </select>
                    </td>
                    <td className="py-1.5 px-2">
                      <button
                        onClick={() => deletePrediction(p.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                        title="Delete prediction"
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

      {predictions.length === 0 && (
        <p className="text-xs text-zinc-600 text-center py-6">
          No predictions yet. Use the form above to log your first call.
        </p>
      )}
    </div>
  );
}
