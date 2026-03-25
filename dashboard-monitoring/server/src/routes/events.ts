import { Router } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';
import type { EventDate } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Hardcoded economic calendar dates ────────────────────────────────

const FOMC_DATES: EventDate[] = [
  // 2025
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  // 2026
  '2026-01-28', '2026-03-18', '2026-05-06', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  // 2027
  '2027-01-27', '2027-03-17', '2027-05-05', '2027-06-16',
  '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08',
].map(date => ({ name: 'FOMC Rate Decision', date, type: 'fomc' as const }));

const CPI_DATES: EventDate[] = [
  // 2025
  '2025-01-15', '2025-02-12', '2025-03-12', '2025-04-10',
  '2025-05-13', '2025-06-11', '2025-07-10', '2025-08-12',
  '2025-09-10', '2025-10-14', '2025-11-12', '2025-12-10',
  // 2026
  '2026-01-14', '2026-02-11', '2026-03-11', '2026-04-10',
  '2026-05-12', '2026-06-10', '2026-07-10', '2026-08-12',
  '2026-09-16', '2026-10-14', '2026-11-12', '2026-12-10',
].map(date => ({ name: 'CPI Report', date, type: 'cpi' as const }));

const NFP_DATES: EventDate[] = [
  // 2025
  '2025-01-10', '2025-02-07', '2025-03-07', '2025-04-04',
  '2025-05-02', '2025-06-06', '2025-07-03', '2025-08-01',
  '2025-09-05', '2025-10-03', '2025-11-07', '2025-12-05',
  // 2026
  '2026-01-09', '2026-02-06', '2026-03-06', '2026-04-03',
  '2026-05-01', '2026-06-05', '2026-07-02', '2026-08-07',
  '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04',
].map(date => ({ name: 'Non-Farm Payrolls', date, type: 'nfp' as const }));

const GDP_DATES: EventDate[] = [
  // 2025 — BEA advance/second/third estimates
  '2025-01-30', '2025-03-27', '2025-04-30', '2025-06-26',
  '2025-07-30', '2025-09-25', '2025-10-29', '2025-12-23',
  // 2026
  '2026-01-29', '2026-03-26', '2026-04-29', '2026-06-25',
  '2026-07-29', '2026-09-24', '2026-10-28', '2026-12-22',
].map(date => ({ name: 'GDP Report', date, type: 'gdp' as const }));

const HARDCODED_EVENTS: EventDate[] = [
  ...FOMC_DATES,
  ...CPI_DATES,
  ...NFP_DATES,
  ...GDP_DATES,
];

// ── Route ────────────────────────────────────────────────────────────

router.get('/api/events', (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Start with hardcoded events
    let allEvents = [...HARDCODED_EVENTS];

    // Merge with data/events.json if it exists
    try {
      const eventsPath = resolve(__dirname, '../../../data/events.json');
      const fileEvents: EventDate[] = JSON.parse(readFileSync(eventsPath, 'utf-8'));
      if (Array.isArray(fileEvents)) {
        // Deduplicate by date+type key
        const seen = new Set(allEvents.map(e => `${e.date}|${e.type}`));
        for (const evt of fileEvents) {
          const key = `${evt.date}|${evt.type}`;
          if (!seen.has(key)) {
            allEvents.push(evt);
            seen.add(key);
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid — that's fine, use hardcoded only
    }

    // Filter to future events and sort ascending
    const futureEvents = allEvents
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(futureEvents);
  } catch (err) {
    log.error(`Events route error: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

export default router;
