import type { StockQuote } from '../types.js';

// IBKR Tick Type IDs
// https://interactivebrokers.github.io/tws-api/tick_types.html
const TICK_BID = 1;
const TICK_ASK = 2;
const TICK_LAST = 4;
const TICK_HIGH = 6;
const TICK_LOW = 7;
const TICK_VOLUME = 8;
const TICK_CLOSE = 9;
const TICK_OPEN = 14;
const TICK_LOW_52W = 19;
const TICK_HIGH_52W = 20;

export function processTickPrice(
  quote: Partial<StockQuote>,
  field: number,
  price: number,
): boolean {
  if (price <= 0 || price === -1) return false;

  let updated = true;
  switch (field) {
    case TICK_BID:
      quote.bidPrice = price;
      break;
    case TICK_ASK:
      quote.askPrice = price;
      break;
    case TICK_LAST:
      quote.lastPrice = price;
      if (quote.close != null && quote.close > 0) {
        quote.change = price - quote.close;
        quote.changePercent = (quote.change / quote.close) * 100;
      }
      break;
    case TICK_HIGH:
      quote.high = price;
      break;
    case TICK_LOW:
      quote.low = price;
      break;
    case TICK_CLOSE:
      quote.close = price;
      if (quote.lastPrice != null) {
        quote.change = quote.lastPrice - price;
        quote.changePercent = (quote.change / price) * 100;
      }
      break;
    case TICK_OPEN:
      quote.open = price;
      break;
    case TICK_LOW_52W:
      quote.low52w = price;
      break;
    case TICK_HIGH_52W:
      quote.high52w = price;
      break;
    default:
      updated = false;
  }

  if (updated) {
    quote.lastUpdate = Date.now();
  }
  return updated;
}

export function processTickSize(
  quote: Partial<StockQuote>,
  field: number,
  size: number,
): boolean {
  if (field === TICK_VOLUME) {
    quote.volume = size;
    quote.lastUpdate = Date.now();
    return true;
  }
  return false;
}
