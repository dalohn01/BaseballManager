export const money = (n: number) => {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}K`;
  return `${sign}$${a.toLocaleString('en-US')}`;
};

export const moneyExact = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export const avg3 = (h: number, ab: number) => (ab === 0 ? '.000' : (h / ab).toFixed(3).replace(/^0/, ''));

export const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

export const era = (runs: number, outs: number) => (outs === 0 ? '–' : ((runs * 27) / outs).toFixed(2));

export function duration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const ROLE_LABEL: Record<string, string> = { starter: 'Starter', reserve: 'Reserve', prospect: 'Prospect' };

export function potentialLabel(low: number, high: number): string {
  const mid = (low + high) / 2;
  if (mid >= 85) return 'Elite';
  if (mid >= 75) return 'High';
  if (mid >= 65) return 'Solid';
  return 'Limited';
}
