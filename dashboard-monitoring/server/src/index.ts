import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import type { IConnectionProvider, IMarketDataProvider, IHistoricalDataProvider } from './providers/types.js';
import { MessageBatcher } from './utils/batcher.js';
import { QuoteCache } from './utils/quoteCache.js';
import { DashboardWSServer } from './ws/wsServer.js';
import themesRouter from './routes/themes.js';
import searchRouter from './routes/search.js';
import eventsRouter from './routes/events.js';
import persistenceRouter from './routes/persistence.js';
import portfolioRouter from './routes/portfolio.js';
import { createHealthRouter } from './routes/health.js';
import { log } from './utils/logger.js';

const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const DATA_SOURCE = process.env.DATA_SOURCE || 'yahoo';

// Express
const app = express();
app.use(cors());
app.use(express.json());

// Provider setup — dynamic import so unused provider's deps aren't loaded
let connection: IConnectionProvider;
let marketData: IMarketDataProvider;
let historicalData: IHistoricalDataProvider;

if (DATA_SOURCE === 'ibkr') {
  const { IBKRConnection } = await import('./ibkr/connection.js');
  const { MarketDataManager } = await import('./ibkr/marketData.js');
  const { HistoricalDataManager } = await import('./ibkr/historicalData.js');

  const IBKR_HOST = process.env.IBKR_HOST || '127.0.0.1';
  const IBKR_PORT = parseInt(process.env.IBKR_PORT || '7497', 10);
  const IBKR_CLIENT_ID = parseInt(process.env.IBKR_CLIENT_ID || '1', 10);

  const ibkrConn = new IBKRConnection(IBKR_HOST, IBKR_PORT, IBKR_CLIENT_ID);
  connection = ibkrConn;
  marketData = new MarketDataManager(ibkrConn);
  historicalData = new HistoricalDataManager(ibkrConn);
} else {
  const { YahooConnectionProvider } = await import('./providers/yahoo/yahooConnection.js');
  const { YahooMarketDataProvider } = await import('./providers/yahoo/yahooMarketData.js');
  const { YahooHistoricalDataProvider } = await import('./providers/yahoo/yahooHistoricalData.js');
  const { YahooOptionsDataProvider } = await import('./providers/yahoo/yahooOptionsData.js');

  const optionsProvider = new YahooOptionsDataProvider();
  const yahooMarketData = new YahooMarketDataProvider();
  yahooMarketData.setOptionsProvider(optionsProvider);

  connection = new YahooConnectionProvider();
  marketData = yahooMarketData;
  historicalData = new YahooHistoricalDataProvider();
}

// Load cached quotes from disk (#3)
const cachedQuotes = QuoteCache.loadFromDisk();
if (cachedQuotes) {
  // Pre-populate the market data provider with cached quotes
  for (const [symbol, quote] of Object.entries(cachedQuotes)) {
    const existing = marketData.getQuote(symbol);
    if (!existing) {
      // Emit cached quotes so they're available to clients immediately
      marketData.emit('tick', symbol, quote);
    }
  }
  log.info(`Restored ${Object.keys(cachedQuotes).length} cached quotes`);
}

// Quote cache — saves to disk every 60s
const quoteCache = new QuoteCache(
  () => marketData.getAllQuotes(),
  () => {}, // setQuotes not needed for Yahoo provider (quotes are internally managed)
);
quoteCache.start();

// Routes
app.use(themesRouter);
app.use(searchRouter);
app.use(eventsRouter);
app.use(persistenceRouter);
app.use(portfolioRouter);
app.use(createHealthRouter(connection, marketData));

// HTTP Server
const server = createServer(app);

// Message batcher — flushes to WebSocket every 100ms
const batcher = new MessageBatcher((data) => {
  wsServer.broadcast({ type: 'QUOTES_UPDATE', data });
}, 100);

// WebSocket Server (separate port for easier dev proxy)
const wsServer = new DashboardWSServer(
  server,
  marketData,
  historicalData,
  batcher,
  connection,
  WS_PORT,
);

// Macro provider — always uses Yahoo regardless of DATA_SOURCE
const { YahooMacroDataProvider } = await import('./providers/yahoo/yahooMacroData.js');
const macroProvider = new YahooMacroDataProvider();
wsServer.setMacroProvider(macroProvider);

// Start
server.listen(API_PORT, async () => {
  log.info(`Data source: ${DATA_SOURCE.toUpperCase()}`);
  log.info(`API server listening on http://localhost:${API_PORT}`);
  log.info(`WebSocket server on ws://localhost:${WS_PORT}`);

  // Connect to data source
  connection.connect();

  // Start macro provider (independent of stock data source)
  try {
    await macroProvider.start();
    log.info('Macro provider started');
  } catch (err) {
    log.error(`Macro provider failed to start: ${(err as Error).message}`);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  log.info('Shutting down...');
  macroProvider.destroy();
  marketData.unsubscribeAll();
  connection.disconnect();
  batcher.destroy();
  quoteCache.destroy();
  wsServer.destroy();
  server.close();
  process.exit(0);
});
