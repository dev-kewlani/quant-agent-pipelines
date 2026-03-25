import { EventEmitter } from 'events';
import YahooFinance from 'yahoo-finance2';
import type { IConnectionProvider, ConnectionStatus } from '../types.js';
import { log } from '../../utils/logger.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

export class YahooConnectionProvider extends EventEmitter implements IConnectionProvider {
  private _status: ConnectionStatus = 'disconnected';
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  get status(): ConnectionStatus {
    return this._status;
  }

  private setStatus(status: ConnectionStatus) {
    if (this._status !== status) {
      this._status = status;
      this.emit('statusChange', status);
    }
  }

  async connect() {
    this.setStatus('connecting');
    try {
      // Test connectivity with a simple quote request
      await yahooFinance.quote('AAPL');
      log.info('Yahoo Finance API connection verified');
      this.setStatus('connected');
    } catch (err) {
      log.error(`Yahoo Finance connection test failed: ${(err as Error).message}`);
      this.setStatus('disconnected');
      // Retry after 5 seconds
      this.retryTimeout = setTimeout(() => this.connect(), 5000);
    }
  }

  disconnect() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    this.setStatus('disconnected');
  }

  isConnected(): boolean {
    return this._status === 'connected';
  }
}
