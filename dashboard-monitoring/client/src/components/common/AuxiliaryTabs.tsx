import { cn } from '@/lib/utils';
import { useFilterStore } from '@/stores/filterStore';
import { PredictionLog } from '@/components/predictions/PredictionLog';
import { PositionManager } from '@/components/portfolio/PositionManager';
import { ThemeHeatMap } from '@/components/theme/ThemeHeatMap';
import { RotationDashboard } from '@/components/analytics/RotationDashboard';
import { MacroIndicators } from '@/components/macro/MacroIndicators';
import { Grid3x3, FileText, Briefcase, ArrowLeftRight, BarChart3 } from 'lucide-react';

const TABS = [
  { id: 'rotation' as const, label: 'Rotation', Icon: ArrowLeftRight },
  { id: 'heatmap' as const, label: 'Heat Map', Icon: Grid3x3 },
  { id: 'indicators' as const, label: 'Indicators', Icon: BarChart3 },
  { id: 'predictions' as const, label: 'Predictions', Icon: FileText },
  { id: 'portfolio' as const, label: 'Portfolio', Icon: Briefcase },
];

export function AuxiliaryTabs() {
  const activeTab = useFilterStore((s) => s.activeAuxTab);
  const setActiveTab = useFilterStore((s) => s.setActiveAuxTab);

  return (
    <div className="mb-5">
      <div className="flex items-center gap-1 border-b border-zinc-800 mb-0">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
              activeTab === id
                ? 'border-blue-500 text-zinc-200'
                : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'rotation' && (
        <div className="pt-3">
          <RotationDashboard />
        </div>
      )}
      {activeTab === 'heatmap' && (
        <div className="pt-3">
          <ThemeHeatMap alwaysExpanded />
        </div>
      )}
      {activeTab === 'indicators' && (
        <div className="pt-3">
          <MacroIndicators />
        </div>
      )}
      {activeTab === 'predictions' && (
        <div className="pt-3">
          <PredictionLog alwaysExpanded />
        </div>
      )}
      {activeTab === 'portfolio' && (
        <div className="pt-3">
          <PositionManager alwaysExpanded />
        </div>
      )}
    </div>
  );
}
