import type { StockQuote } from '@/types/market';

// Seed-based random for consistent mock data per symbol
function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const basePrices: Record<string, number> = {
  // Nuclear
  CEG: 280, VST: 165, BWXT: 120, FLR: 55, SMR: 18, OKLO: 35,
  CCJ: 55, UEC: 8, UUUU: 7, URNM: 48,
  FCX: 45, SCCO: 105, PWR: 320, ACM: 110, MYRG: 175,
  // Real Assets
  TPL: 1200, FPI: 12, LAND: 14, RYN: 32, WY: 30,
  IRM: 120, AMT: 210, SBAC: 220, BIPC: 42, PLD: 120,
  DE: 420, AGCO: 105, CNHI: 12, ADM: 50, BG: 85,
  // Bitcoin
  IBIT: 55, MSTR: 380, COIN: 260,
  MARA: 22, RIOT: 12, CLSK: 15,
  GLD: 240, NEM: 48, GOLD: 18, AEM: 85,
  // Longevity
  LLY: 780, RXRX: 8, VRTX: 475, VEEV: 230, INSP: 190,
  ILMN: 120, PACB: 2, TXG: 15, TWST: 42, RGEN: 155,
  ACHC: 55, UHS: 210,
  // Physical Experience
  LYV: 130, SPHR: 55, MSGS: 230, MTN: 175,
  MAR: 270, HLT: 240, RCL: 220, MODG: 15, PLNT: 85, PLAY: 35,
  'BF.B': 45, DEO: 115, FER: 38, BA: 185,
  // Water
  AWK: 135, WTRG: 38, MSEX: 58, YORW: 38, CWT: 52,
  XYL: 130, MWA: 22, LNN: 125, WTS: 210, VEOEY: 14,
  // Skilled Trades
  FIX: 420, IBP: 215, BLD: 380, STRL: 175, PRIM: 75,
  FTDR: 55, WSC: 42, CNM: 50,
  SNA: 280, PII: 60,
  // Mental Health
  TALK: 2, LFST: 7, HIMS: 55, NHC: 105, SPRC: 1.5,
  // AI & ML
  NVDA: 130, MSFT: 420, GOOGL: 175, META: 580, AMZN: 200,
  PLTR: 80, AI: 30, SNOW: 170, MDB: 260, DDOG: 130,
  PATH: 14, UPST: 70, BBAI: 5, SOUN: 12,
  // Semiconductors
  TSM: 185, AVGO: 190, AMD: 155, INTC: 22, QCOM: 175,
  ASML: 720, LRCX: 75, AMAT: 180, KLAC: 680, MRVL: 85,
  ARM: 160, ON: 60, NXPI: 230, ADI: 220, TXN: 185, MU: 95,
  // Financials
  JPM: 240, GS: 540, MS: 110, BAC: 42, C: 68,
  BLK: 920, SCHW: 80, ICE: 155, CME: 230, SPGI: 490,
  WFC: 70, USB: 48, PNC: 195, TFC: 42, AXP: 280,
  // Fintech
  V: 310, MA: 520, PYPL: 75, SQ: 78, AFRM: 55,
  FI: 185, INTU: 630, BILL: 65, TOST: 38, FOUR: 65,
  SOFI: 12, LC: 12, HOOD: 25,
  // B2B SaaS
  CRM: 290, NOW: 890, WDAY: 260, HUBS: 640, ZS: 220,
  PANW: 190, CRWD: 340, FTNT: 95, NET: 100, TEAM: 250,
  MNDY: 280, DOCU: 80, TWLO: 65, ZI: 15,
  // B2C / Consumer
  SHOP: 100, SPOT: 580, NFLX: 920, DIS: 105, ABNB: 140,
  BKNG: 4800, UBER: 75, LYFT: 15, PINS: 32, SNAP: 10,
  ROKU: 75, CHWY: 30, ETSY: 55, DASH: 170,
  // Delivery & Logistics
  UPS: 125, FDX: 260, XPO: 130, ODFL: 195, SAIA: 430,
  ZTO: 22, CHRW: 95, GXO: 50, JBHT: 160,
  // Cybersecurity
  // (PANW, CRWD, FTNT, ZS already above)
  OKTA: 100, CYBR: 310, S: 22, VRNS: 50, TENB: 42,
  RPD: 40, QLYS: 130,
  // Aerospace & Defense
  LMT: 470, RTX: 120, NOC: 490, GD: 290, LHX: 220,
  HWM: 105, TDG: 1350, HEI: 250, AXON: 600,
  // EV & Autonomous
  TSLA: 340, RIVN: 14, LCID: 2.5, NIO: 4.5, LI: 28,
  XPEV: 15, QS: 5, CHPT: 1.5, BLNK: 2,
  // Robotics & Automation
  ROK: 280, ABB: 52, ISRG: 540, TER: 105, CGNX: 42,
  IRBT: 8, BRKS: 115,
  // Clean Energy & Solar
  ENPH: 70, SEDG: 18, FSLR: 180, RUN: 12, NOVA: 8,
  NEE: 75, AES: 14, BEP: 25, PLUG: 2,
  // Space
  RKLB: 25, ASTS: 28, LUNR: 10, RDW: 3, BKSY: 3, IRDM: 28,
  // Gaming
  RBLX: 55, EA: 145, TTWO: 210, NTDOY: 72, U: 22,
  // Indices (ETFs)
  SPY: 560, QQQ: 485, DIA: 420, IWM: 210, VTI: 270,
  EFA: 78, EEM: 42, VWO: 42, FXI: 28, EWZ: 28,
  EWJ: 68, EWG: 30, EWU: 32, INDA: 50,
  // Sector ETFs
  XLK: 215, XLF: 44, XLE: 88, XLV: 145, XLI: 130,
  XLY: 195, XLP: 80, XLU: 75, XLB: 85, XLRE: 40, XLC: 90,
  // Currencies
  UUP: 28, FXE: 105, FXY: 62, FXB: 122, FXC: 72,
  FXA: 65, FXF: 108, USDU: 26,
  CEW: 18, WisdomTreeEM: 20,
  // Fixed Income
  TLT: 88, IEF: 95, SHY: 82, LQD: 108, HYG: 76,
  AGG: 98, BND: 72, TIPS: 108, EMB: 85, MUB: 107,
  // EM specific
  BABA: 85, PDD: 110, JD: 35, MELI: 1800, SE: 100,
  GRAB: 5, NU_STOCK: 14, VALE: 10, PBR: 13, ITUB: 6,
  // Luxury
  LVMUY: 145, HESAY: 48, CPRI: 22, TPR: 60, RL: 210, EL: 65,
  // Ag & Food Tech
  CTVA: 55, FMC: 45, ANDE: 45, VITL: 25,
  // Insurance
  PGR: 240, ALL: 195, MET: 82, AFL: 105, CB: 280,
  AIG: 75, TRV: 240, HIG: 115,
  // Robotics Supply Chain
  NJDCY: 48, NOVT: 175, TKR: 85, ROLL: 310, DMGRY: 22,
  HXL: 70, TRYIY: 12,
  // Grid Deep Infrastructure
  ESE: 130, POWL: 280, GEV: 380, NVT: 75, PLPC: 32, HON: 210, ETN: 330,
  // Rare Earths
  MP: 22, LYSDY: 5,
  // Auth & Trust
  VERI: 3, TRI: 170,
  // Vocational Education
  LINC: 15, UTI: 25, LRN: 105, PRDO: 22, SWK: 82,
  // Physical Infra & Materials
  VMC: 260, MLM: 580, GLW: 45, LITE: 55, ENTG: 120, APD: 280, LIN: 440,
  // Additional from new themes
  CAT: 350, NU: 14,
};

export function generateMockQuote(symbol: string): StockQuote {
  const rng = seededRandom(symbol);
  const base = basePrices[symbol] || 50 + rng() * 150;
  const changePct = (rng() - 0.48) * 4;
  const change = base * (changePct / 100);
  const last = base + change;

  // Generate period performance with realistic correlations
  const momentum = (rng() - 0.4) * 2; // slight positive bias
  const change1m = parseFloat(((rng() - 0.45) * 15 + momentum).toFixed(2));
  const change3m = parseFloat(((rng() - 0.42) * 30 + momentum * 2).toFixed(2));
  const change6m = parseFloat(((rng() - 0.40) * 50 + momentum * 3).toFixed(2));
  const changeYtd = parseFloat(((rng() - 0.38) * 40 + momentum * 2.5).toFixed(2));
  const change1y = parseFloat(((rng() - 0.35) * 70 + momentum * 4).toFixed(2));

  return {
    symbol,
    lastPrice: parseFloat(last.toFixed(2)),
    close: base,
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(changePct.toFixed(2)),
    high: parseFloat((last * (1 + rng() * 0.015)).toFixed(2)),
    low: parseFloat((last * (1 - rng() * 0.015)).toFixed(2)),
    open: parseFloat((base * (1 + (rng() - 0.5) * 0.01)).toFixed(2)),
    bidPrice: parseFloat((last - 0.01).toFixed(2)),
    askPrice: parseFloat((last + 0.01).toFixed(2)),
    volume: Math.floor(rng() * 10_000_000),
    high52w: parseFloat((base * (1.15 + rng() * 0.25)).toFixed(2)),
    low52w: parseFloat((base * (0.55 + rng() * 0.15)).toFixed(2)),
    change1m,
    change3m,
    change6m,
    changeYtd,
    change1y,
    change2y: parseFloat(((rng() - 0.30) * 100 + momentum * 5).toFixed(2)),
    change3y: parseFloat(((rng() - 0.28) * 150 + momentum * 6).toFixed(2)),
    change5y: parseFloat(((rng() - 0.25) * 200 + momentum * 8).toFixed(2)),
    changeMax: parseFloat(((rng() - 0.20) * 400 + momentum * 10).toFixed(2)),
    ivPercentile: Math.floor(rng() * 100),
    lastUpdate: Date.now(),
  };
}

export function generateAllMockQuotes(symbols: string[]): Record<string, StockQuote> {
  const quotes: Record<string, StockQuote> = {};
  for (const symbol of symbols) {
    quotes[symbol] = generateMockQuote(symbol);
  }
  return quotes;
}
