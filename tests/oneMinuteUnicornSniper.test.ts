import { evaluate1mUnicornSniperEntry } from '../src/entryMechanics';
import type { Candle } from '../src/types';

describe('1M Unicorn Sniper Entry Mechanism (CLT)', () => {
  test('returns confirmed when 1M SFP sweep + breaker + dynamic 0.5 fib retest occurs', () => {
    // Simulated 1M candles for a SHORT setup inside 15M POI [1.1000 - 1.1020]
    const baseTime = 1700000000000;
    const candles1m: Candle[] = [
      // 0..4: Approaching and touching zone (High reaches 1.1005)
      { open: 1.0990, high: 1.0995, low: 1.0988, close: 1.0994, timestamp: baseTime },
      { open: 1.0994, high: 1.1005, low: 1.0992, close: 1.1002, timestamp: baseTime + 60000 }, // Touch!
      // 2: Sweep candle (High reaches 1.1015, sweeps prior high 1.1005, closes at 1.0998)
      { open: 1.1002, high: 1.1015, low: 1.0995, close: 1.0998, timestamp: baseTime + 120000 },
      // 3: MSS / Breaker candle with displacement (closes below 1.0995 at 1.0985)
      { open: 1.0998, high: 1.1000, low: 1.0982, close: 1.0985, timestamp: baseTime + 180000 },
      // 4: Pullback / Retest bar reaching 0.5 Fib (Extreme=1.1015, Low=1.0982 -> Fib05 = 1.09985)
      { open: 1.0985, high: 1.1000, low: 1.0984, close: 1.0990, timestamp: baseTime + 240000 },
    ];

    const result = evaluate1mUnicornSniperEntry({
      direction: 'short',
      zoneLow: 1.1000,
      zoneHigh: 1.1020,
      symbol: 'EURUSD',
      candles1m,
      maxWait1mBars: 30,
    });

    expect(result.confirmed).toBe(true);
    expect(result.reason).toBe('1M_UNICORN_SNIPER_CONFIRMED');
    expect(result.entryPrice).toBeCloseTo(1.09985, 4);
    expect(result.stopLoss).toBeGreaterThan(1.1015);
    expect(result.riskDistance).toBeGreaterThan(0);
    expect(result.tp1Price).toBeLessThan(result.entryPrice!);
    expect(result.tp2Price).toBeLessThan(result.tp1Price!);
  });

  test('rejects entry when price slices through 15M zone without reaction', () => {
    const baseTime = 1700000000000;
    // 20 consecutive candles blowing through zoneHigh 1.1020
    const candles1m: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles1m.push({
        open: 1.1022 + i * 0.0002,
        high: 1.1025 + i * 0.0002,
        low: 1.1021 + i * 0.0002,
        close: 1.1024 + i * 0.0002,
        timestamp: baseTime + i * 60000,
      });
    }

    const result = evaluate1mUnicornSniperEntry({
      direction: 'short',
      zoneLow: 1.1000,
      zoneHigh: 1.1020,
      symbol: 'EURUSD',
      candles1m,
    });

    expect(result.confirmed).toBe(false);
  });
});
