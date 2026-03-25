import { EventEmitter } from 'events';
import { IBApi, EventName, ErrorCode } from '@stoqey/ib';
import { log } from '../utils/logger.js';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export class IBKRConnection extends EventEmitter {
  private ib: IBApi;
  private _status: ConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private nextValidOrderId = 0;

  constructor(
    private host: string,
    private port: number,
    private clientId: number,
  ) {
    super();
    this.ib = new IBApi({ host, port, clientId });
    this.setupEventHandlers();
  }

  get api(): IBApi {
    return this.ib;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get orderId(): number {
    return this.nextValidOrderId;
  }

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    this.emit('statusChange', status);
  }

  private setupEventHandlers() {
    this.ib.on(EventName.connected, () => {
      log.info('Connected to TWS');
      this.setStatus('connected');
      this.reconnectDelay = 1000;
    });

    this.ib.on(EventName.disconnected, () => {
      log.warn('Disconnected from TWS');
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });

    this.ib.on(EventName.nextValidId, (orderId: number) => {
      this.nextValidOrderId = orderId;
      log.info(`Next valid order ID: ${orderId}`);
    });

    this.ib.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
      const numCode = code as number;
      if (code === ErrorCode.NOT_CONNECTED) {
        log.warn('Not connected to TWS');
        return;
      }
      // Market data farm connection messages are informational
      if (numCode === 2104 || numCode === 2106 || numCode === 2158) {
        log.debug(`TWS info [${numCode}]: ${err.message}`);
        return;
      }
      log.error(`TWS error [code=${numCode}, reqId=${reqId}]: ${err.message}`);
      this.emit('ibkrError', { error: err, code, reqId });
    });
  }

  connect() {
    if (this._status === 'connecting') return;
    log.info(`Connecting to TWS at ${this.host}:${this.port} (clientId=${this.clientId})`);
    this.setStatus('connecting');
    try {
      this.ib.connect(this.clientId);
    } catch (err) {
      log.error('Failed to connect:', err);
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this._status !== 'disconnected') {
      this.ib.disconnect();
      this.setStatus('disconnected');
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    log.info(`Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  isConnected(): boolean {
    return this._status === 'connected';
  }
}
