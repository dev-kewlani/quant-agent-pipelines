import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';
import type { PredictionEntry, WatchlistItem } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

const DATA_DIR = resolve(__dirname, '../../../data');
const PREDICTIONS_PATH = resolve(DATA_DIR, 'predictions.json');
const WATCHLIST_PATH = resolve(DATA_DIR, 'watchlist.json');

// ── Helpers ──────────────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T[]): T[] {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(filePath: string, data: T[]): void {
  ensureDataDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Predictions ──────────────────────────────────────────────────────

router.get('/api/predictions', (_req, res) => {
  try {
    const predictions = readJson<PredictionEntry>(PREDICTIONS_PATH, []);
    res.json(predictions);
  } catch (err) {
    log.error(`Failed to load predictions: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to load predictions' });
  }
});

router.post('/api/predictions', (req, res) => {
  try {
    const predictions = readJson<PredictionEntry>(PREDICTIONS_PATH, []);
    const entry: PredictionEntry = {
      id: generateId(),
      date: req.body.date || new Date().toISOString().slice(0, 10),
      thesis: req.body.thesis || '',
      instrument: req.body.instrument || '',
      direction: req.body.direction || 'long',
      magnitude: req.body.magnitude || '',
      timeframe: req.body.timeframe || '',
      outcome: 'pending',
      notes: req.body.notes || '',
      entryPrice: req.body.entryPrice ?? null,
      entryIvPercentile: req.body.entryIvPercentile ?? null,
      entryMacroRegime: req.body.entryMacroRegime ?? null,
      exitPrice: null,
      exitDate: null,
    };
    predictions.push(entry);
    writeJson(PREDICTIONS_PATH, predictions);
    log.info(`Prediction added: ${entry.id} — ${entry.instrument} ${entry.direction}`);
    res.status(201).json(entry);
  } catch (err) {
    log.error(`Failed to save prediction: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to save prediction' });
  }
});

router.put('/api/predictions/:id', (req, res) => {
  try {
    const predictions = readJson<PredictionEntry>(PREDICTIONS_PATH, []);
    const idx = predictions.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Prediction not found' });
    }
    const updatable = ['outcome', 'notes', 'exitPrice', 'exitDate'] as const;
    for (const key of updatable) {
      if (req.body[key] !== undefined) {
        (predictions[idx] as any)[key] = req.body[key];
      }
    }
    writeJson(PREDICTIONS_PATH, predictions);
    log.info(`Prediction updated: ${req.params.id}`);
    res.json(predictions[idx]);
  } catch (err) {
    log.error(`Failed to update prediction: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to update prediction' });
  }
});

router.delete('/api/predictions/:id', (req, res) => {
  try {
    let predictions = readJson<PredictionEntry>(PREDICTIONS_PATH, []);
    const before = predictions.length;
    predictions = predictions.filter(p => p.id !== req.params.id);
    if (predictions.length === before) {
      return res.status(404).json({ error: 'Prediction not found' });
    }
    writeJson(PREDICTIONS_PATH, predictions);
    log.info(`Prediction deleted: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    log.error(`Failed to delete prediction: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to delete prediction' });
  }
});

// ── Watchlist ────────────────────────────────────────────────────────

router.get('/api/watchlist', (_req, res) => {
  try {
    const watchlist = readJson<WatchlistItem>(WATCHLIST_PATH, []);
    res.json(watchlist);
  } catch (err) {
    log.error(`Failed to load watchlist: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to load watchlist' });
  }
});

router.post('/api/watchlist', (req, res) => {
  try {
    const watchlist = readJson<WatchlistItem>(WATCHLIST_PATH, []);
    const symbol = (req.body.symbol || '').toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    if (watchlist.some(w => w.symbol === symbol)) {
      return res.status(409).json({ error: 'Symbol already in watchlist' });
    }
    const item: WatchlistItem = {
      symbol,
      name: req.body.name || symbol,
      addedAt: Date.now(),
    };
    watchlist.push(item);
    writeJson(WATCHLIST_PATH, watchlist);
    log.info(`Watchlist added: ${symbol}`);
    res.status(201).json(item);
  } catch (err) {
    log.error(`Failed to save watchlist item: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to save watchlist item' });
  }
});

router.delete('/api/watchlist/:symbol', (req, res) => {
  try {
    let watchlist = readJson<WatchlistItem>(WATCHLIST_PATH, []);
    const symbol = req.params.symbol.toUpperCase();
    const before = watchlist.length;
    watchlist = watchlist.filter(w => w.symbol !== symbol);
    if (watchlist.length === before) {
      return res.status(404).json({ error: 'Symbol not in watchlist' });
    }
    writeJson(WATCHLIST_PATH, watchlist);
    log.info(`Watchlist removed: ${symbol}`);
    res.json({ success: true });
  } catch (err) {
    log.error(`Failed to delete watchlist item: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to delete watchlist item' });
  }
});

export default router;
