import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IMarketDataProvider, IHistoricalDataProvider, IConnectionProvider } from '../providers/types.js';
import type { MessageBatcher } from '../utils/batcher.js';
import type { ClientMessage, ServerMessage, StockQuote, MacroData, VolumeAlert } from '../types.js';
import type { EventEmitter } from 'events';
import { log } from '../utils/logger.js';

export interface IMacroProvider extends EventEmitter {
  getLatest(): MacroData | null;
}

export class DashboardWSServer {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval: ReturnType<typeof setInterval>;

  private macroProvider: IMacroProvider | null = null;

  constructor(
    server: Server,
    private marketData: IMarketDataProvider,
    private historicalData: IHistoricalDataProvider,
    private batcher: MessageBatcher,
    private connection: IConnectionProvider,
    wsPort?: number,
  ) {
    if (wsPort) {
      this.wss = new WebSocketServer({ port: wsPort });
      log.info(`WebSocket server listening on port ${wsPort}`);
    } else {
      this.wss = new WebSocketServer({ server });
      log.info('WebSocket server attached to HTTP server');
    }

    this.setupWSS();
    this.setupBatcher();
    this.setupConnectionForward();
    this.setupVolumeAlerts();

    // Heartbeat every 30s
    this.heartbeatInterval = setInterval(() => this.pingClients(), 30000);
  }

  setMacroProvider(provider: IMacroProvider) {
    this.macroProvider = provider;
    provider.on('macro', (data: MacroData) => {
      this.broadcast({ type: 'MACRO_UPDATE', data });
    });
  }

  private setupWSS() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      log.info(`Client connected (total: ${this.clients.size})`);

      // Send current connection status
      this.send(ws, {
        type: 'CONNECTION_STATUS',
        status: this.connection.status,
      });

      // Send current cached quotes
      const allQuotes = this.marketData.getAllQuotes();
      if (Object.keys(allQuotes).length > 0) {
        this.send(ws, { type: 'QUOTES_UPDATE', data: allQuotes });
      }

      // Send current cached macro data
      if (this.macroProvider) {
        const macroData = this.macroProvider.getLatest();
        if (macroData) {
          this.send(ws, { type: 'MACRO_UPDATE', data: macroData });
        }
      }

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;
          this.handleClientMessage(ws, msg);
        } catch {
          log.warn('Invalid WebSocket message received');
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        log.info(`Client disconnected (total: ${this.clients.size})`);
      });

      ws.on('error', (err) => {
        log.error('WebSocket client error:', err.message);
        this.clients.delete(ws);
      });
    });
  }

  private handleClientMessage(_ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case 'SUBSCRIBE':
        log.info(`Subscribe request: ${msg.symbols.join(', ')}`);
        this.marketData.subscribe(msg.symbols);
        break;

      case 'UNSUBSCRIBE':
        log.info(`Unsubscribe request: ${msg.symbols.join(', ')}`);
        this.marketData.unsubscribe(msg.symbols);
        break;

      case 'REQUEST_HISTORICAL':
        log.info(`Historical data request: ${msg.symbol}`);
        this.historicalData
          .requestBars(msg.symbol, msg.duration, msg.barSize)
          .then((bars) => {
            // Send only to the requesting client
            this.send(_ws, { type: 'HISTORICAL_DATA', symbol: msg.symbol, bars });
          })
          .catch((err) => {
            log.error(`Historical data error for ${msg.symbol}: ${err.message}`);
          });
        break;
    }
  }

  private setupBatcher() {
    this.marketData.on('tick', (symbol: string, quote: Partial<StockQuote>) => {
      this.batcher.add(symbol, quote);
    });
  }

  private setupConnectionForward() {
    this.connection.on('statusChange', (status: string) => {
      this.broadcast({
        type: 'CONNECTION_STATUS',
        status: status as 'connected' | 'disconnected' | 'connecting',
      });
    });
  }

  // Volume alert forwarding (#9)
  private setupVolumeAlerts() {
    this.marketData.on('volumeAlert', (alert: VolumeAlert) => {
      this.broadcast({ type: 'VOLUME_ALERT', alert });
    });
  }

  broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private pingClients() {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }

  destroy() {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}
