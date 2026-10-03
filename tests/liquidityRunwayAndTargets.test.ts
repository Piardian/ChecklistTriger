import { evaluateLiquidityRunway } from '../server/pipeline';
import { extractCandidateDisplay } from '../server/communicationLayer';
import { evaluateOutcome } from '../src/signalOutcomeTracker';
import type { NotificationCandidate } from '../server/pipeline';
import type { Candle } from '../src/types';
import { createSignalContext } from '../src/signalContext';

function makeDummyCandle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp, open, high, low, close };
}

function makeDummyCandidate(direction: 'long' | 'short' = 'long'): NotificationCandidate {
  const event = {
    type: 'BOS' as const,
    direction: direction === 'long' ? 'bullish' as const : 'bearish' as const,
    brokenSwing: {} as any,
    breakCandleIndex: 10,
    breakTimestamp: 10000,
    breakClosePrice: direction === 'long' ? 1.0870 : 1.0830,
  };
  const poi = {
    direction: direction === 'long' ? 'bullish' as const : 'bearish' as const,
    candleIndex: 10,
    low: 1.0850,
    high: 1.0860,
    formedAtIndex: 10,
    relatedEvent: event,
  };
  const signalContext = createSignalContext({
    signalId: `TEST_${direction}`,
    pair: 'EURUSD',
    direction,
    timeframe: '15m',
    grade: 'A+',
    score: 9,
    timestamp: 10000,
    lifecycleStates: ['DETECTED', 'GRADED'],
  });

  return {
    symbol: 'EURUSD',
    tradeDirection: direction,
    poiType: 'OB',
    poi,
    gradeResult: {
      totalScore: 9,
      grade: 'A+',
      entryAllowed: true,
      blockReasons: [],
      breakdown: { htfBiasPD: 2, displacement: 2, structure: 2, sweep: 2, poiQuality: 1 },
    },
    uniqueKey: `TEST_${direction}`,
    signalId: `TEST_${direction}`,
    signalContext,
    currentPrice: direction === 'long' ? 1.0870 : 1.0830,
    marketDataTimestamp: 10000,
    validationCloseTimestamp: 10000,
    poiFormedTimestamp: 9000,
    bias4H: direction === 'long' ? 'bullish' : 'bearish',
    bias1H: direction === 'long' ? 'bullish' : 'bearish',
    poiTestCount: 0,
    pd4H: direction === 'long' ? 'discount' : 'premium',
    pd1H: direction === 'long' ? 'discount' : 'premium',
    pd15M: direction === 'long' ? 'discount' : 'premium',
  } as NotificationCandidate;
}

describe('Item 2: Minimum 1.8R Liquidity Runway Filter', () => {
  test('allows trade when open sky exists (no obstacles or magnets ahead)', () => {
    const res = evaluateLiquidityRunway(
      'EURUSD',
      'long',
      { low: 1.0850, high: 1.0860 },
      null,
      null
    );
    expect(res.allowed).toBe(true);
    expect(res.runwayR).toBeNull();
  });

  test('blocks long trade when active liquidity magnet is closer than 1.8R', () => {
    // Entry midpoint: 1.0855. Stop: 1.0849 (low - 1 pip). Risk: 0.0006 (6 pips).
    // Magnet at 1.0863 (only 8 pips ahead = 1.33R).
    const magnet = {
      type: 'EQH' as const,
      priceLevel: 1.0863,
      pointsCount: 2,
      distancePips: 8,
      isActive: true,
      description: 'EQH test',
    };
    const res = evaluateLiquidityRunway(
      'EURUSD',
      'long',
      { low: 1.0850, high: 1.0860 },
      magnet,
      null
    );
    expect(res.allowed).toBe(false);
    expect(res.runwayR).toBeLessThan(1.8);
    expect(res.barrierType).toBe('EQH');
  });

  test('allows long trade when active liquidity magnet is at 2.5R ahead', () => {
    // Magnet at 1.0872 (17 pips ahead = ~2.83R)
    const magnet = {
      type: 'EQH' as const,
      priceLevel: 1.0872,
      pointsCount: 2,
      distancePips: 17,
      isActive: true,
      description: 'EQH far away',
    };
    const res = evaluateLiquidityRunway(
      'EURUSD',
      'long',
      { low: 1.0850, high: 1.0860 },
      magnet,
      null
    );
    expect(res.allowed).toBe(true);
    expect(res.runwayR).toBeGreaterThanOrEqual(1.8);
  });

  test('blocks short trade when opposing obstacle is closer than 1.8R', () => {
    // Entry midpoint: 1.0855. Stop: 1.0861 (high + 1 pip). Risk: 0.0006.
    // Opposing Bullish OB level: low=1.0845, high=1.0848 (distance to high = 7 pips = 1.16R).
    const obstacle = {
      hasObstacle: true,
      obstacleType: 'OB' as const,
      timeframe: '15m' as const,
      level: { low: 1.0845, high: 1.0848 },
      distancePips: 7,
      warningText: 'Opposing OB',
    };
    const res = evaluateLiquidityRunway(
      'EURUSD',
      'short',
      { low: 1.0850, high: 1.0860 },
      null,
      obstacle
    );
    expect(res.allowed).toBe(false);
    expect(res.runwayR).toBeLessThan(1.8);
  });
});

describe('Item 3: Numerical Targets and Break-Even Resolution', () => {
  test('extractCandidateDisplay calculates exact TP1, TP2, TP3 and Stop levels', () => {
    const candidate = makeDummyCandidate('long');
    const display = extractCandidateDisplay(candidate);

    expect(display.entryMidpoint).toBeCloseTo(1.0855);
    expect(display.tp1Price).toBeCloseTo(1.0861, 4); // +1.0R (6 pips)
    expect(display.tp2Price).toBeCloseTo(1.0867, 4); // +2.0R (12 pips)
    expect(display.tp1Text).toContain('+1.0R | Stop Maliyete / BE');
    expect(display.tp2Text).toContain('+2.0R | Ana Hedef');
    expect(display.stopLossText).toContain('-1.0R');
  });

  test('evaluateOutcome triggers BREAK_EVEN when price hits +1.0R and then retraces', () => {
    const candidate = makeDummyCandidate('long');
    // Entry at midpoint 1.0855, stop at 1.0849 (risk: 0.0006).
    // Target (+2R) at 1.0867.
    // Future candles:
    // Candle 0: triggers entry (low: 1.0854, high: 1.0858)
    // Candle 1: reaches +1.1R (high: 1.0862, low: 1.0856) -> Arms Break-Even
    // Candle 2: retraces to entry (low: 1.0853, high: 1.0858) -> Hits Break-Even at 1.0855
    const future = [
      makeDummyCandle(20000, 1.0865, 1.0866, 1.0854, 1.0856), // Entry triggered
      makeDummyCandle(920000, 1.0856, 1.0862, 1.0856, 1.0860), // +1.16R favorable excursion -> Arms BE
      makeDummyCandle(1820000, 1.0860, 1.0860, 1.0852, 1.0853), // Retraces through entry price 1.0855
    ];

    const result = evaluateOutcome(candidate, future, {
      entryWindowBars: 4,
      maxHoldBars: 8,
      breakEvenTriggerR: 1.0,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome?.outcomeType).toBe('BREAK_EVEN');
    expect(result.rrAchieved).toBe(0);
    expect(result.outcome?.reason.code).toBe('BREAK_EVEN_REACHED');
  });
});
