import { Router } from 'express';
import YahooFinance from 'yahoo-finance2';
import { log } from '../utils/logger.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const router = Router();

router.get('/api/search', async (req, res) => {
  const query = (req.query.q as string || '').trim();
  if (!query || query.length < 1) {
    return res.json([]);
  }

  try {
    const result = await yahooFinance.search(query, { newsCount: 0 });
    const quotes = (result.quotes || [])
      .filter((q: any) => q.symbol && q.shortname)
      .slice(0, 20)
      .map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        type: q.quoteType || 'EQUITY',
        exchange: q.exchDisp || q.exchange || '',
      }));
    res.json(quotes);
  } catch (err) {
    log.error(`Search error for "${query}": ${(err as Error).message}`);
    res.json([]);
  }
});

export default router;
