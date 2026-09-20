import { filterClosedCandles } from '../server/pipeline';
import { Candle } from '../src/types';

describe('filterClosedCandles', () => {
  const candles: Candle[] = [
    { timestamp: 0, open: 1, high: 2, low: 0, close: 1 },
    { timestamp: 15 * 60 * 1000, open: 1, high: 2, low: 0, close: 1 },
    { timestamp: 30 * 60 * 1000, open: 1, high: 2, low: 0, close: 1 },
  ];

  it('excludes the currently forming candle based on its bar duration', () => {
    const result = filterClosedCandles(
      candles,
      15 * 60 * 1000,
      35 * 60 * 1000
    );

    expect(result.map(candle => candle.timestamp)).toEqual([
      0,
      15 * 60 * 1000,
    ]);
  });

  it('includes a candle exactly at its close boundary', () => {
    const result = filterClosedCandles(
      candles,
      15 * 60 * 1000,
      45 * 60 * 1000
    );

    expect(result).toHaveLength(3);
  });

  it('returns no candles for invalid analysis timestamps', () => {
    expect(filterClosedCandles(candles, 15 * 60 * 1000, Number.NaN)).toEqual([]);
  });
});
