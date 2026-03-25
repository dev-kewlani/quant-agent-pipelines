import { create } from 'zustand';
import type { RevenueRegion } from '@/components/stock/RevenueFilter';
import type { PerformancePeriod } from '@/types/market';

const DEFAULT_VISIBLE_COLUMNS = new Set([
  'symbol', 'name', 'lastPrice', 'changePercent', 'periodChange',
  'suppressionScore', 'ivPercentile', 'range', 'volume', 'sparkline',
]);

interface FilterState {
  revenueFilter: RevenueRegion;
  performancePeriod: PerformancePeriod;
  showVsSpy: boolean;
  visibleColumns: Set<string>;
  sidebarCollapsed: boolean;
  activeAuxTab: 'heatmap' | 'predictions' | 'portfolio' | 'rotation' | 'indicators' | null;

  setRevenueFilter: (r: RevenueRegion) => void;
  setPerformancePeriod: (p: PerformancePeriod) => void;
  toggleVsSpy: () => void;
  toggleColumn: (id: string) => void;
  toggleSidebar: () => void;
  setActiveAuxTab: (tab: FilterState['activeAuxTab']) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  revenueFilter: 'all',
  performancePeriod: '1M',
  showVsSpy: false,
  visibleColumns: new Set(DEFAULT_VISIBLE_COLUMNS),
  sidebarCollapsed: false,
  activeAuxTab: null,

  setRevenueFilter: (revenueFilter) => set({ revenueFilter }),
  setPerformancePeriod: (performancePeriod) => set({ performancePeriod }),
  toggleVsSpy: () => set((s) => ({ showVsSpy: !s.showVsSpy })),
  toggleColumn: (id) =>
    set((s) => {
      const next = new Set(s.visibleColumns);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { visibleColumns: next };
    }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveAuxTab: (tab) =>
    set((s) => ({ activeAuxTab: s.activeAuxTab === tab ? null : tab })),
}));

export const ALL_COLUMN_DEFS: { id: string; label: string; group: string }[] = [
  // Core
  { id: 'symbol', label: 'Symbol', group: 'Core' },
  { id: 'name', label: 'Name', group: 'Core' },
  { id: 'lastPrice', label: 'Price', group: 'Core' },
  { id: 'change', label: 'Change', group: 'Core' },
  { id: 'changePercent', label: '% Change', group: 'Core' },
  { id: 'periodChange', label: 'Period', group: 'Core' },
  // Analytics
  { id: 'suppressionScore', label: 'Suppression', group: 'Analytics' },
  { id: 'relativeStrength', label: 'Rel Strength', group: 'Analytics' },
  { id: 'momentum', label: 'Momentum', group: 'Analytics' },
  { id: 'beta', label: 'Beta', group: 'Analytics' },
  // Analyst
  { id: 'analystRating', label: 'Analyst', group: 'Analyst' },
  { id: 'analystTarget', label: 'Target', group: 'Analyst' },
  // Volatility
  { id: 'ivPercentile', label: 'IV %ile', group: 'Volatility' },
  { id: 'ivRank', label: 'IV Rank', group: 'Volatility' },
  { id: 'ivHvRatio', label: 'IV/HV', group: 'Volatility' },
  // Range & Volume
  { id: 'high52w', label: '52W High', group: 'Range' },
  { id: 'low52w', label: '52W Low', group: 'Range' },
  { id: 'range', label: 'Range', group: 'Range' },
  { id: 'volume', label: 'Volume', group: 'Range' },
  { id: 'sparkline', label: 'Sparkline', group: 'Chart' },
];
