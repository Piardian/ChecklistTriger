import { detectOpposingObstacle } from '../src/opposingObstacleDetector';
import { OrderBlock, FVG } from '../src/types';

describe('Opposing Obstacle Detector', () => {
  it('detects Bearish OB as an obstacle above Long entry zone', () => {
    const activeOBs: OrderBlock[] = [
      {
        direction: 'bearish',
        candleIndex: 20,
        high: 1.0535,
        low: 1.0525,
        formedAtIndex: 20,
        relatedEvent: {} as any,
      },
    ];
    const activeFVGs: FVG[] = [];

    const result = detectOpposingObstacle({
      symbol: 'EURUSD',
      tradeDirection: 'long',
      entryZone: { low: 1.0500, high: 1.0510 },
      activeOrderBlocks15m: activeOBs,
      activeFVGs15m: activeFVGs,
      minClearancePips: 25,
    });

    expect(result.hasObstacle).toBe(true);
    expect(result.obstacleType).toBe('OB');
    expect(result.distancePips).toBeCloseTo(15, 1);
    expect(result.warningText).toContain('15M Bearish OB');
  });

  it('detects Bullish FVG as an obstacle below Short entry zone', () => {
    const activeOBs: OrderBlock[] = [];
    const activeFVGs: FVG[] = [
      {
        direction: 'bullish',
        gapHigh: 1.3520,
        gapLow: 1.3510,
        gapSizePips: 10,
        ratioToDisplacementCandle: 0.5,
        middleCandleIndex: 18,
        relatedEvent: {} as any,
      },
    ];

    const result = detectOpposingObstacle({
      symbol: 'GBPUSD',
      tradeDirection: 'short',
      entryZone: { low: 1.3530, high: 1.3540 },
      activeOrderBlocks15m: activeOBs,
      activeFVGs15m: activeFVGs,
      minClearancePips: 25,
    });

    expect(result.hasObstacle).toBe(true);
    expect(result.obstacleType).toBe('FVG');
    expect(result.distancePips).toBeCloseTo(10, 1);
    expect(result.warningText).toContain('15M Bullish FVG');
  });

  it('reports no obstacle when path is clear', () => {
    const result = detectOpposingObstacle({
      symbol: 'EURUSD',
      tradeDirection: 'long',
      entryZone: { low: 1.0500, high: 1.0510 },
      activeOrderBlocks15m: [],
      activeFVGs15m: [],
    });

    expect(result.hasObstacle).toBe(false);
    expect(result.obstacleType).toBeNull();
  });
  it('does not treat a mitigated 15M obstacle as an active blocker', () => {
    const ob: OrderBlock = {
      direction: 'bearish',
      candleIndex: 1,
      high: 1.0535,
      low: 1.0525,
      formedAtIndex: 1,
      relatedEvent: {} as any,
    };

    const candles = [
      { timestamp: 0, high: 1.0500, low: 1.0490, close: 1.0495 },
      { timestamp: 1, high: 1.0530, low: 1.0520, close: 1.0528 },
      { timestamp: 2, high: 1.0530, low: 1.0526, close: 1.0528 },
    ];

    const result = detectOpposingObstacle({
      symbol: 'EURUSD',
      tradeDirection: 'long',
      entryZone: { low: 1.0500, high: 1.0510 },
      activeOrderBlocks15m: [ob],
      activeFVGs15m: [],
      candles15m: candles,
      currentIndex15m: 2,
      minClearancePips: 25,
    });

    expect(result.hasObstacle).toBe(false);
  });

  it('falls back to an active 1H obstacle when the 15M path is clear', () => {
    const ob: OrderBlock = {
      direction: 'bearish',
      candleIndex: 1,
      high: 1.0535,
      low: 1.0525,
      formedAtIndex: 1,
      relatedEvent: {} as any,
    };

    const result = detectOpposingObstacle({
      symbol: 'EURUSD',
      tradeDirection: 'long',
      entryZone: { low: 1.0500, high: 1.0510 },
      activeOrderBlocks15m: [],
      activeFVGs15m: [],
      activeOrderBlocks1h: [ob],
      activeFVGs1h: [],
      minClearancePips: 25,
    });

    expect(result.hasObstacle).toBe(true);
    expect(result.timeframe).toBe('1h');
    expect(result.lifecycle).toBe('ACTIVE');
  });

});
