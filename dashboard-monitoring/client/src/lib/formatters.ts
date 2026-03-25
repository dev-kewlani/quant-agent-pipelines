export function formatPrice(price: number | null | undefined): string {
  if (price == null) return '--';
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatChange(change: number | null | undefined): string {
  if (change == null) return '--';
  const prefix = change >= 0 ? '+' : '';
  return `${prefix}${change.toFixed(2)}`;
}

export function formatPercent(pct: number | null | undefined): string {
  if (pct == null) return '--';
  const prefix = pct >= 0 ? '+' : '';
  return `${prefix}${pct.toFixed(2)}%`;
}

export function formatVolume(vol: number | null | undefined): string {
  if (vol == null) return '--';
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toString();
}

export function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
