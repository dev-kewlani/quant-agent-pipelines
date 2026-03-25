import { Router } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Theme } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

const THEMES_PATH = resolve(__dirname, '../../../data/themes.json');

// Read once on module load and cache in memory
let cachedThemes: Theme[] = JSON.parse(readFileSync(THEMES_PATH, 'utf-8'));

function reloadThemes(): Theme[] {
  cachedThemes = JSON.parse(readFileSync(THEMES_PATH, 'utf-8'));
  return cachedThemes;
}

router.get('/api/themes', (req, res) => {
  try {
    if (req.query.reload === 'true') {
      reloadThemes();
    }
    res.json(cachedThemes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load themes' });
  }
});

export default router;
