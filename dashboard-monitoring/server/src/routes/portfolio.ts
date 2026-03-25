import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';
import type { PositionEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

const DATA_DIR = resolve(__dirname, '../../../data');
const PORTFOLIO_PATH = resolve(DATA_DIR, 'portfolio.json');

// ── Helpers ──────────────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readPortfolio(): PositionEntry[] {
  try {
    const raw = readFileSync(PORTFOLIO_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePortfolio(data: PositionEntry[]): void {
  ensureDataDir();
  writeFileSync(PORTFOLIO_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Routes ───────────────────────────────────────────────────────────

router.get('/api/portfolio', (_req, res) => {
  try {
    const portfolio = readPortfolio();
    res.json(portfolio);
  } catch (err) {
    log.error(`Failed to load portfolio: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to load portfolio' });
  }
});

router.post('/api/portfolio', (req, res) => {
  try {
    const portfolio = readPortfolio();
    const symbol = (req.body.symbol || '').toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const entry: PositionEntry = {
      id: generateId(),
      symbol,
      shares: Number(req.body.shares) || 0,
      costBasis: Number(req.body.costBasis) || 0,
      dateAdded: req.body.dateAdded || new Date().toISOString().slice(0, 10),
      notes: req.body.notes || '',
    };
    portfolio.push(entry);
    writePortfolio(portfolio);
    log.info(`Position added: ${entry.id} — ${symbol} x${entry.shares}`);
    res.status(201).json(entry);
  } catch (err) {
    log.error(`Failed to save position: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to save position' });
  }
});

router.put('/api/portfolio/:id', (req, res) => {
  try {
    const portfolio = readPortfolio();
    const idx = portfolio.findIndex(p => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Position not found' });
    }
    const updatable = ['symbol', 'shares', 'costBasis', 'notes'] as const;
    for (const key of updatable) {
      if (req.body[key] !== undefined) {
        (portfolio[idx] as any)[key] = key === 'shares' || key === 'costBasis'
          ? Number(req.body[key])
          : key === 'symbol'
            ? (req.body[key] as string).toUpperCase().trim()
            : req.body[key];
      }
    }
    writePortfolio(portfolio);
    log.info(`Position updated: ${req.params.id}`);
    res.json(portfolio[idx]);
  } catch (err) {
    log.error(`Failed to update position: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to update position' });
  }
});

router.delete('/api/portfolio/:id', (req, res) => {
  try {
    let portfolio = readPortfolio();
    const before = portfolio.length;
    portfolio = portfolio.filter(p => p.id !== req.params.id);
    if (portfolio.length === before) {
      return res.status(404).json({ error: 'Position not found' });
    }
    writePortfolio(portfolio);
    log.info(`Position deleted: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    log.error(`Failed to delete position: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to delete position' });
  }
});

export default router;
