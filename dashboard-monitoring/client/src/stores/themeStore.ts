import { create } from 'zustand';
import type { Theme } from '@/types/theme';

interface ThemeState {
  themes: Theme[];
  activeThemeId: string | null;
  setThemes: (themes: Theme[]) => void;
  setActiveTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  themes: [],
  activeThemeId: null,
  setThemes: (themes) => set({ themes, activeThemeId: themes[0]?.id ?? null }),
  setActiveTheme: (id) => set({ activeThemeId: id }),
}));

export function useActiveTheme(): Theme | undefined {
  return useThemeStore((s) => s.themes.find((t) => t.id === s.activeThemeId));
}
