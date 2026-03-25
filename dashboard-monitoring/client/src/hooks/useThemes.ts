import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import type { Theme } from '@/types/theme';

export function useThemes() {
  const setThemes = useThemeStore((s) => s.setThemes);

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((themes: Theme[]) => setThemes(themes))
      .catch((err) => {
        console.error('Failed to load themes, using fallback fetch:', err);
        // Fallback: try direct server URL
        fetch('http://localhost:3001/api/themes')
          .then((r) => r.json())
          .then((themes: Theme[]) => setThemes(themes))
          .catch((err2) => console.error('Fallback also failed:', err2));
      });
  }, [setThemes]);
}
