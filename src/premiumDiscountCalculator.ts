import { Candle, SwingPoint, PremiumDiscountState } from './types';

export const PREMIUM_DISCOUNT_THRESHOLD = 0.5 as const;

/**
 * Calculates Premium/Discount (Fib) status from the latest confirmed dealing range.
 *
 * The range is defined by the latest confirmed adjacent high/low swing pair,
 * rather than independently selecting the latest high and latest low from
 * different structural legs. This avoids accidentally combining unrelated
 * swing points into one dealing range.
 *
 * Premium/discount split: > 0.50 is premium, < 0.50 is discount, exactly
 * 0.50 is equilibrium. Keep this threshold versioned with the analysis rulebook.
 */
export function calculatePremiumDiscount(
  candles: Candle[],
  swings: SwingPoint[],
  currentIndex: number
): PremiumDiscountState {
  if (currentIndex < 0 || currentIndex >= candles.length) {
    return { status: 'undefined', fibValue: null, rangeHigh: null, rangeLow: null };
  }

  const confirmedSwings = swings
    .filter(s => s.confirmedAtIndex <= currentIndex)
    .slice()
    .sort((a, b) => {
      if (a.confirmedAtIndex !== b.confirmedAtIndex) {
        return a.confirmedAtIndex - b.confirmedAtIndex;
      }
      return a.formedAtIndex - b.formedAtIndex;
    });

  if (confirmedSwings.length < 2) {
    return {
      status: 'undefined',
      fibValue: null,
      rangeHigh: null,
      rangeLow: null,
    };
  }

  // Find the most recent adjacent pair made of opposite swing types.
  // Two consecutive highs (or lows) do not define a dealing range by themselves.
  let rangeHighSwing: SwingPoint | null = null;
  let rangeLowSwing: SwingPoint | null = null;

  for (let i = confirmedSwings.length - 1; i > 0; i -= 1) {
    const newer = confirmedSwings[i];
    const older = confirmedSwings[i - 1];
    if (newer.type === older.type) continue;

    rangeHighSwing = newer.type === 'high' ? newer : older;
    rangeLowSwing = newer.type === 'low' ? newer : older;
    break;
  }

  if (!rangeHighSwing || !rangeLowSwing) {
    return {
      status: 'undefined',
      fibValue: null,
      rangeHigh: null,
      rangeLow: null,
    };
  }

  const rangeHigh = Math.max(rangeHighSwing.price, rangeLowSwing.price);
  const rangeLow = Math.min(rangeHighSwing.price, rangeLowSwing.price);

  if (rangeHigh === rangeLow) {
    return {
      status: 'undefined',
      fibValue: null,
      rangeHigh: null,
      rangeLow: null,
    };
  }

  const currentPrice = candles[currentIndex].close;
  const fibValue = (currentPrice - rangeLow) / (rangeHigh - rangeLow);

  let status: 'premium' | 'discount' | 'eq';
  if (fibValue > PREMIUM_DISCOUNT_THRESHOLD) {
    status = 'premium';
  } else if (fibValue < PREMIUM_DISCOUNT_THRESHOLD) {
    status = 'discount';
  } else {
    status = 'eq';
  }

  return {
    status,
    fibValue,
    rangeHigh,
    rangeLow,
  };
}
