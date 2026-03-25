import { useMacroStore } from '@/stores/macroStore';
import { EventCountdowns } from './EventCountdowns';
import type { MacroSignal, BreadthData } from '@/types/market';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const regimeColors = {
  'risk-on': {
    dot: 'bg-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    text: 'text-emerald-400',
    label: 'Risk-On',
  },
  caution: {
    dot: 'bg-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    text: 'text-amber-400',
    label: 'Caution',
  },
  'risk-off': {
    dot: 'bg-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    text: 'text-red-400',
    label: 'Risk-Off',
  },
};

function TrendIcon({ trend }: { trend: 'rising' | 'falling' | 'flat' }) {
  if (trend === 'rising') return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (trend === 'falling') return <TrendingDown className="h-3 w-3 text-red-400" />;
  return <Minus className="h-3 w-3 text-zinc-600" />;
}

function SignalCard({ signal }: { signal: MacroSignal }) {
  const colors = regimeColors[signal.regime];
  return (
    <div className={cn('flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 min-w-[145px]', colors.bg)}>
      <div className="flex items-center gap-1.5">
        <div className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 flex-1">{signal.name}</span>
        <TrendIcon trend={signal.trend} />
      </div>
      <div className="text-xs font-mono text-zinc-200 leading-tight">{signal.label}</div>
      <div className="flex items-center gap-1.5">
        <span className={cn('text-[10px] font-semibold uppercase', colors.text)}>{colors.label}</span>
        {signal.zScore != null && (
          <span className="text-[10px] font-mono text-zinc-600">z={signal.zScore.toFixed(1)}</span>
        )}
        {signal.rateOfChange != null && (
          <span className={cn('text-[10px] font-mono', signal.rateOfChange >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {signal.rateOfChange >= 0 ? '+' : ''}{signal.rateOfChange.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function BreadthCard({ breadth }: { breadth: BreadthData }) {
  const colors = regimeColors[breadth.regime];
  return (
    <div className={cn('flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 min-w-[145px]', colors.bg)}>
      <div className="flex items-center gap-1.5">
        <div className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 flex-1">Breadth</span>
        <TrendIcon trend={breadth.rspSpyTrend} />
      </div>
      <div className="text-xs font-mono text-zinc-200 leading-tight">{breadth.label}</div>
      <div className="flex items-center gap-1.5">
        <span className={cn('text-[10px] font-semibold uppercase', colors.text)}>{colors.label}</span>
        {breadth.rspSpyRatioZScore != null && (
          <span className="text-[10px] font-mono text-zinc-600">z={breadth.rspSpyRatioZScore.toFixed(1)}</span>
        )}
      </div>
    </div>
  );
}

function OverallRegime({ signals }: { signals: MacroSignal[] }) {
  const counts = { 'risk-on': 0, caution: 0, 'risk-off': 0 };
  for (const s of signals) counts[s.regime]++;

  let overall: MacroSignal['regime'] = 'caution';
  if (counts['risk-on'] >= 3) overall = 'risk-on';
  else if (counts['risk-off'] >= 3) overall = 'risk-off';
  else if (counts['risk-on'] > counts['risk-off']) overall = 'risk-on';
  else if (counts['risk-off'] > counts['risk-on']) overall = 'risk-off';

  const colors = regimeColors[overall];
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 pr-3 border-r border-zinc-700/50 min-w-[80px]">
      <div className={cn('h-2.5 w-2.5 rounded-full', colors.dot)} />
      <span className={cn('text-[11px] font-bold uppercase tracking-wide', colors.text)}>{colors.label}</span>
      <span className="text-[10px] text-zinc-600">{counts['risk-on']}G {counts.caution}Y {counts['risk-off']}R</span>
    </div>
  );
}

function VixDisplay({ vix }: { vix: number | null }) {
  if (vix == null) return null;
  let color = 'text-emerald-400';
  if (vix > 25) color = 'text-red-400';
  else if (vix > 15) color = 'text-amber-400';
  return (
    <div className="flex flex-col items-center justify-center gap-0 pl-3 border-l border-zinc-700/50 min-w-[65px]">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">VIX</span>
      <span className={cn('text-xl font-bold font-mono tabular-nums leading-tight', color)}>{vix.toFixed(1)}</span>
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 mb-3">
      <div className="flex flex-col items-center gap-1 pr-3 border-r border-zinc-700/50 min-w-[80px]">
        <div className="h-2.5 w-2.5 rounded-full bg-zinc-700 animate-pulse" />
        <div className="h-3 w-10 rounded bg-zinc-700 animate-pulse" />
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-800/50 px-2.5 py-1.5 min-w-[145px]">
          <div className="h-2 w-16 rounded bg-zinc-700 animate-pulse" />
          <div className="h-3 w-24 rounded bg-zinc-700 animate-pulse" />
          <div className="h-2 w-12 rounded bg-zinc-700 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function MacroRegimePanel() {
  const macroData = useMacroStore((s) => s.macroData);

  if (!macroData) return <SkeletonPanel />;

  return (
    <div className="space-y-2 mb-4">
      {/* Macro signals row */}
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 overflow-x-auto">
        <OverallRegime signals={macroData.signals} />
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
          {macroData.signals.map((signal) => (
            <SignalCard key={signal.name} signal={signal} />
          ))}
          {macroData.breadth && <BreadthCard breadth={macroData.breadth} />}
        </div>
        <VixDisplay vix={macroData.vix} />
      </div>

      {/* Event countdowns — integrated into macro section */}
      <EventCountdowns />
    </div>
  );
}
