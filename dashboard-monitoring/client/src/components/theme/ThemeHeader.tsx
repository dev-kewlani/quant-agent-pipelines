import { useState } from 'react';
import type { Theme } from '@/types/theme';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { iconMap, defaultIcon } from '@/lib/iconMap';

export function ThemeHeader({ theme }: { theme: Theme }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = iconMap[theme.icon] || defaultIcon;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="h-7 w-7 text-blue-400" />
        <h1 className="text-2xl font-bold text-zinc-100">{theme.name}</h1>
      </div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {expanded ? 'Hide thesis' : 'Show thesis'}
      </button>
      {expanded && (
        <p className="mt-2 text-sm leading-relaxed text-zinc-400 max-w-3xl">
          {theme.thesis}
        </p>
      )}
    </div>
  );
}
