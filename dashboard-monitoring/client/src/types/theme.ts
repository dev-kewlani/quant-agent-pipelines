export interface ThemeStock {
  symbol: string;
  name: string;
  note: string;
  revenueGeo?: {
    us?: number;
    europe?: number;
    asia?: number;
    em?: number;
    other?: number;
  };
}

export interface Layer {
  id: string;
  name: string;
  order?: number; // 1=direct, 2=first-order, 3=second-order, 4=third/fourth-order
  stocks: ThemeStock[];
}

export type ThemeCategory =
  | 'thematic'
  | 'index'
  | 'currency'
  | 'fixed-income'
  | 'sector'
  | 'macro';

export interface Theme {
  id: string;
  name: string;
  thesis: string;
  icon: string;
  category: ThemeCategory;
  layers: Layer[];
}

export const CATEGORY_LABELS: Record<ThemeCategory, string> = {
  thematic: 'Investment Themes',
  sector: 'Sectors',
  index: 'Indices',
  currency: 'Currencies',
  'fixed-income': 'Fixed Income',
  macro: 'Macro & EM',
};

export const CATEGORY_ORDER: ThemeCategory[] = [
  'thematic',
  'sector',
  'index',
  'macro',
  'currency',
  'fixed-income',
];
