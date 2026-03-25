import { Contract, SecType } from '@stoqey/ib';

export function createStockContract(symbol: string): Contract {
  return {
    symbol: symbol.replace('.', ' '), // IBKR uses space for class (e.g. BF B)
    secType: SecType.STK,
    exchange: 'SMART',
    currency: 'USD',
  };
}

export function createEtfContract(symbol: string): Contract {
  return {
    symbol,
    secType: SecType.STK,
    exchange: 'SMART',
    currency: 'USD',
    primaryExch: 'ARCA',
  };
}

const ETF_SYMBOLS = new Set([
  'IBIT', 'GLD', 'URNM', 'VEOEY',
]);

export function createContract(symbol: string): Contract {
  if (ETF_SYMBOLS.has(symbol)) {
    return createEtfContract(symbol);
  }
  return createStockContract(symbol);
}
