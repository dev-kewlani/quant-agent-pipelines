import { useMemo, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { EventDate } from '@/types/market';

interface EventWithCountdown extends EventDate {
  daysAway: number;
}

const EVENT_COLORS: Record<string, { color: string; bgColor: string }> = {
  fomc: { color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/40' },
  cpi: { color: 'text-purple-400', bgColor: 'bg-purple-500/20 border-purple-500/40' },
  nfp: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/20 border-emerald-500/40' },
  gdp: { color: 'text-amber-400', bgColor: 'bg-amber-500/20 border-amber-500/40' },
  earnings: { color: 'text-cyan-400', bgColor: 'bg-cyan-500/20 border-cyan-500/40' },
  other: { color: 'text-zinc-400', bgColor: 'bg-zinc-500/20 border-zinc-500/40' },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Fallback hardcoded events in case server fetch fails
const FALLBACK_EVENTS: EventDate[] = [
  // FOMC 2026
  { name: 'FOMC', date: '2026-01-28', type: 'fomc' },
  { name: 'FOMC', date: '2026-03-18', type: 'fomc' },
  { name: 'FOMC', date: '2026-05-06', type: 'fomc' },
  { name: 'FOMC', date: '2026-06-17', type: 'fomc' },
  { name: 'FOMC', date: '2026-07-29', type: 'fomc' },
  { name: 'FOMC', date: '2026-09-16', type: 'fomc' },
  { name: 'FOMC', date: '2026-10-28', type: 'fomc' },
  { name: 'FOMC', date: '2026-12-09', type: 'fomc' },
  // CPI 2026
  { name: 'CPI', date: '2026-03-11', type: 'cpi' },
  { name: 'CPI', date: '2026-04-10', type: 'cpi' },
  { name: 'CPI', date: '2026-05-12', type: 'cpi' },
  { name: 'CPI', date: '2026-06-10', type: 'cpi' },
  { name: 'CPI', date: '2026-07-10', type: 'cpi' },
  { name: 'CPI', date: '2026-08-12', type: 'cpi' },
];

export function EventCountdowns() {
  const [serverEvents, setServerEvents] = useState<EventDate[] | null>(null);

  // Fetch events from server (#11)
  useEffect(() => {
    fetch('/api/events')
      .then((r) => r.json())
      .then((data: EventDate[]) => setServerEvents(data))
      .catch(() => {
        // Fallback to direct server URL
        fetch('http://localhost:3001/api/events')
          .then((r) => r.json())
          .then((data: EventDate[]) => setServerEvents(data))
          .catch(() => setServerEvents(null));
      });
  }, []);

  const events = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const allEvents = serverEvents || FALLBACK_EVENTS;

    // Get the next occurrence of each event type
    const nextByType = new Map<string, EventWithCountdown>();

    for (const event of allEvents) {
      if (event.date < today) continue;
      const diff = Math.ceil(
        (new Date(event.date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const key = event.type;
      if (!nextByType.has(key) || diff < nextByType.get(key)!.daysAway) {
        nextByType.set(key, { ...event, daysAway: diff });
      }
    }

    return Array.from(nextByType.values()).sort((a, b) => a.daysAway - b.daysAway);
  }, [serverEvents]);

  if (events.length === 0) return null;

  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mr-1">
        Events
      </span>
      {events.map((event) => {
        const isToday = event.daysAway === 0;
        const isSoon = event.daysAway <= 3;
        const colors = EVENT_COLORS[event.type] || EVENT_COLORS.other;

        return (
          <div
            key={`${event.type}-${event.date}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-mono',
              isToday
                ? colors.bgColor + ' animate-pulse'
                : isSoon
                  ? 'border-zinc-700 bg-zinc-800/80'
                  : 'border-zinc-800 bg-zinc-900/50',
            )}
          >
            <span className={cn('font-semibold', colors.color)}>
              {event.name}
            </span>
            <span className="text-zinc-400">
              {isToday ? (
                <span className="text-white font-bold">TODAY</span>
              ) : (
                <>
                  in{' '}
                  <span className={cn('font-bold', isSoon ? 'text-amber-400' : 'text-zinc-200')}>
                    {event.daysAway}d
                  </span>
                </>
              )}
            </span>
            <span className="text-zinc-600 text-[10px]">
              {formatDate(event.date)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
