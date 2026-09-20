import { Candle, SwingPoint } from '../src/types';
import { calculatePremiumDiscount } from '../src/premiumDiscountCalculator';

function createBaseCandles(length: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < length; i++) {
    candles.push({ timestamp: 1000 * i, open: 100, high: 100, low: 100, close: 100 });
  }
  return candles;
}

describe('Premium / Discount (Fib) Calculator', () => {
  const swings: SwingPoint[] = [
    { type: 'low', price: 100, formedAtIndex: 2, confirmedAtIndex: 4, timestamp: 2000 },
    { type: 'high', price: 200, formedAtIndex: 5, confirmedAtIndex: 7, timestamp: 5000 },
  ];

  test('should return undefined if there are not enough confirmed swings', () => {
    const candles = createBaseCandles(10);
    const result = calculatePremiumDiscount(candles, swings, 5);
    expect(result.status).toBe('undefined');
    expect(result.fibValue).toBeNull();
  });

  test('should return undefined and guard against zero-division if rangeHigh equals rangeLow', () => {
    const candles = createBaseCandles(10);
    const flatSwings: SwingPoint[] = [
      { type: 'low', price: 150, formedAtIndex: 2, confirmedAtIndex: 4, timestamp: 2000 },
      { type: 'high', price: 150, formedAtIndex: 5, confirmedAtIndex: 7, timestamp: 5000 },
    ];
    const result = calculatePremiumDiscount(candles, flatSwings, 8);
    expect(result.status).toBe('undefined');
    expect(result.fibValue).toBeNull();
    expect(result.rangeHigh).toBeNull();
    expect(result.rangeLow).toBeNull();
  });

  test('should classify premium, discount, and eq correctly based on fib values', () => {
    const candles = createBaseCandles(10);
    candles[8].close = 160;
    expect(calculatePremiumDiscount(candles, swings, 8).status).toBe('premium');
    expect(calculatePremiumDiscount(candles, swings, 8).fibValue).toBeCloseTo(0.6);

    candles[8].close = 140;
    expect(calculatePremiumDiscount(candles, swings, 8).status).toBe('discount');
    expect(calculatePremiumDiscount(candles, swings, 8).fibValue).toBeCloseTo(0.4);

    candles[8].close = 150;
    expect(calculatePremiumDiscount(candles, swings, 8).status).toBe('eq');
    expect(calculatePremiumDiscount(candles, swings, 8).fibValue).toBeCloseTo(0.5);
  });

  test('should evaluate boundary values correctly', () => {
    const candles = createBaseCandles(10);
    candles[8].close = 149.99;
    expect(calculatePremiumDiscount(candles, swings, 8).status).toBe('discount');
    candles[8].close = 150;
    expect(calculatePremiumDiscount(candles, swings, 8).status).toBe('eq');
    candles[8].close = 150.01;
    expect(calculatePremiumDiscount(candles, swings, 8).status).toBe('premium');
  });

  test('should use the latest adjacent opposite swing pair instead of unrelated latest high/low points', () => {
    const candles = createBaseCandles(20);
    const complexSwings: SwingPoint[] = [
      { type: 'low', price: 100, formedAtIndex: 2, confirmedAtIndex: 4, timestamp: 2000 },
      { type: 'high', price: 200, formedAtIndex: 5, confirmedAtIndex: 7, timestamp: 5000 },
      { type: 'high', price: 240, formedAtIndex: 8, confirmedAtIndex: 10, timestamp: 8000 },
      { type: 'low', price: 180, formedAtIndex: 11, confirmedAtIndex: 13, timestamp: 11000 },
    ];
    candles[14].close = 210;

    const result = calculatePremiumDiscount(candles, complexSwings, 14);

    expect(result.rangeLow).toBe(180);
    expect(result.rangeHigh).toBe(240);
    expect(result.fibValue).toBeCloseTo(0.5);
    expect(result.status).toBe('eq');
  });

  test('lookahead bias simulation for premium/discount calculator', () => {
    const candles = createBaseCandles(20);
    const swingsList: SwingPoint[] = [
      { type: 'low', price: 100, formedAtIndex: 2, confirmedAtIndex: 4, timestamp: 2000 },
      { type: 'high', price: 200, formedAtIndex: 5, confirmedAtIndex: 7, timestamp: 5000 },
    ];

    candles[8].close = 160;
    candles[9].close = 130;

    const batchResults = candles.map((_, idx) => calculatePremiumDiscount(candles, swingsList, idx));
    const simulatedResults: any[] = [];
    for (let t = 1; t <= candles.length; t++) {
      const sliceCandles = candles.slice(0, t);
      simulatedResults.push(calculatePremiumDiscount(sliceCandles, swingsList, t - 1));
    }

    expect(simulatedResults).toHaveLength(batchResults.length);
    for (let i = 0; i < batchResults.length; i++) {
      expect(simulatedResults[i]).toMatchObject(batchResults[i]);
    }
  });
});
