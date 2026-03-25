import { create } from 'zustand';

interface WatchlistItem {
  symbol: string;
  name: string;
  addedAt: number;
}

interface WatchlistState {
  items: WatchlistItem[];
  loaded: boolean;
  addItem: (symbol: string, name: string) => void;
  removeItem: (symbol: string) => void;
  hasItem: (symbol: string) => boolean;
  loadFromServer: () => Promise<void>;
}

const LOCAL_STORAGE_KEY = 'dashboard-watchlist';

function loadLocal(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocal(items: WatchlistItem[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
}

async function saveToServer(item: WatchlistItem) {
  try {
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
  } catch {
    // Server persistence is best-effort; localStorage is the fallback
  }
}

async function deleteFromServer(symbol: string) {
  try {
    await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
  } catch {
    // Best-effort
  }
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  items: loadLocal(),
  loaded: false,

  addItem: (symbol, name) => {
    const current = get().items;
    if (current.some((i) => i.symbol === symbol)) return;
    const item: WatchlistItem = { symbol, name, addedAt: Date.now() };
    const updated = [...current, item];
    saveLocal(updated);
    saveToServer(item);
    set({ items: updated });
  },

  removeItem: (symbol) => {
    const updated = get().items.filter((i) => i.symbol !== symbol);
    saveLocal(updated);
    deleteFromServer(symbol);
    set({ items: updated });
  },

  hasItem: (symbol) => {
    return get().items.some((i) => i.symbol === symbol);
  },

  loadFromServer: async () => {
    try {
      const res = await fetch('/api/watchlist');
      if (res.ok) {
        const serverItems: WatchlistItem[] = await res.json();
        if (serverItems.length > 0) {
          // Merge: server items take precedence, add any local-only items
          const serverSymbols = new Set(serverItems.map((i) => i.symbol));
          const localOnly = get().items.filter((i) => !serverSymbols.has(i.symbol));
          const merged = [...serverItems, ...localOnly];
          saveLocal(merged);
          set({ items: merged, loaded: true });
          // Push local-only items to server
          for (const item of localOnly) {
            saveToServer(item);
          }
          return;
        }
      }
    } catch {
      // Fall back to localStorage
    }
    set({ loaded: true });
  },
}));
