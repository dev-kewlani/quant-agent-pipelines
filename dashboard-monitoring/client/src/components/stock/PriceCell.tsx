import { formatPrice } from '@/lib/formatters';

export function PriceCell({ value }: { value: number | null | undefined }) {
  return (
    <span className="font-mono text-sm tabular-nums text-zinc-100">
      {formatPrice(value)}
    </span>
  );
}
