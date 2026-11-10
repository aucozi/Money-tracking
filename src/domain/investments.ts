import { currencyToBase, type Ctx } from './context';
import type { Holding, ID } from './types';

export interface HoldingView {
  holding: Holding;
  /** In the base currency. */
  value: number;
  cost: number | null;
  gain: number | null;
  /** Gain as a fraction of cost, e.g. 0.12 for +12%. */
  gainFraction: number | null;
  /** Share of the whole portfolio, 0..1. */
  weight: number;
}

export interface Portfolio {
  holdings: HoldingView[];
  value: number;
  /** Total paid for the holdings whose cost is known. */
  cost: number;
  /** Gain across the holdings whose cost is known; null when none is. */
  gain: number | null;
  gainFraction: number | null;
  /** True when some holdings have no cost recorded, so the gain is partial. */
  partialCost: boolean;
}

/** Everything held, valued in the base currency, largest position first. */
export function portfolio(holdings: readonly Holding[], ctx: Ctx, accountId?: ID): Portfolio {
  const own = accountId ? holdings.filter((holding) => holding.accountId === accountId) : holdings;
  const views = own.map((holding) => {
    const value = currencyToBase(holding.marketValue, holding.currency, ctx);
    const cost = holding.costBasis !== undefined ? currencyToBase(holding.costBasis, holding.currency, ctx) : null;
    const gain = cost !== null ? value - cost : null;
    return { holding, value, cost, gain, gainFraction: gain !== null && cost ? gain / cost : null, weight: 0 };
  });
  const value = views.reduce((total, view) => total + view.value, 0);
  const priced = views.filter((view) => view.cost !== null);
  const cost = priced.reduce((total, view) => total + (view.cost ?? 0), 0);
  const gain = priced.length > 0 ? priced.reduce((total, view) => total + (view.gain ?? 0), 0) : null;
  return {
    holdings: views
      .map((view) => ({ ...view, weight: value > 0 ? view.value / value : 0 }))
      .sort((a, b) => b.value - a.value || a.holding.name.localeCompare(b.holding.name)),
    value,
    cost,
    gain,
    gainFraction: gain !== null && cost > 0 ? gain / cost : null,
    partialCost: priced.length < views.length && priced.length > 0,
  };
}

/** Price of one share, in minor units of the holding's currency. Null when there are no shares. */
export function pricePerShare(holding: Pick<Holding, 'marketValue' | 'shares'>): number | null {
  return holding.shares > 0 ? Math.round(holding.marketValue / holding.shares) : null;
}

/** "+12.3%" / "−4.0%". */
export function formatFraction(fraction: number): string {
  const percent = Math.abs(fraction * 100);
  const text = percent >= 100 ? percent.toFixed(0) : percent.toFixed(1);
  return `${fraction < 0 ? '−' : '+'}${text}%`;
}
