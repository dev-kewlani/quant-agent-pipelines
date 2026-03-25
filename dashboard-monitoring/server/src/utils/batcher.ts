import type { StockQuote } from '../types.js';

export class MessageBatcher {
  private buffer: Map<string, Partial<StockQuote>> = new Map();
  private flushInterval: ReturnType<typeof setInterval>;

  constructor(
    private onFlush: (data: Record<string, Partial<StockQuote>>) => void,
    intervalMs = 100,
  ) {
    this.flushInterval = setInterval(() => this.flush(), intervalMs);
  }

  add(symbol: string, update: Partial<StockQuote>) {
    const existing = this.buffer.get(symbol) || {};
    this.buffer.set(symbol, { ...existing, ...update });
  }

  private flush() {
    if (this.buffer.size === 0) return;
    const data = Object.fromEntries(this.buffer);
    this.buffer.clear();
    this.onFlush(data);
  }

  destroy() {
    clearInterval(this.flushInterval);
    this.buffer.clear();
  }
}
