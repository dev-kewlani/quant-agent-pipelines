import { create } from 'zustand';
import type { MacroData } from '@/types/market';

interface MacroState {
  macroData: MacroData | null;
  setMacroData: (data: MacroData) => void;
}

export const useMacroStore = create<MacroState>((set) => ({
  macroData: null,
  setMacroData: (data) => set({ macroData: data }),
}));
