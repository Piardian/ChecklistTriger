import { evaluateOutcome, buildResearchOutcomePlan, MarketDataOutcomeTracker } from '../src/signalOutcomeTracker';
import type { Candle } from '../src/types';
import type { NotificationCandidate } from '../server/pipeline';
import { createSignalContext } from '../src/signalContext';

function candle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp, open, high, low, close };
}

function buildCandidate(direction: 'long' | 'short' = 'long'): NotificationCandidate {
  const event = {
    type: 'BOS' as const,
    direction: direction === 'long' ? 'bullish' as const : 'bearish' as const,
    brokenSwing: {} as any,
    breakCandleIndex: 10,
    breakTimestamp: 10000,
    breakClosePrice: direction === 'long' ? 1.11 : 1.09,
  };
  const poi = direction === 'long'
    ? { direction: 'bullish' as const, candleIndex: 10, low: 1.10, high: 1.11, formedAtIndex: 10, relatedEvent: event }
    : { direction: 'bearish' as const, candleIndex: 10, low: 1.10, high: 1.11, formedAtIndex: 10, relatedEvent: event };
  const signalContext = createSignalContext({
    signalId: `TEST_${direction}`,
    pair: 'EURUSD',
    direction,
    timeframe: '15m',
    grade: 'A+',
    score: 9,
    timestamp: 10000,
    lifecycleStates: ['DETECTED', 'GRADED', 'EXECUTION_READY'],
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
    currentPrice: direction === 'long' ? 1.115 : 1.095,
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

describe('Market data outcome tracker', () => {
  test('builds an explicit research evaluation plan', () => {
    const plan = buildResearchOutcomePlan(buildCandidate(), {
      entryWindowBars: 4,
      maxHoldBars: 8,
      targetRMultiple: 2,
      invalidationBufferPips: 1,
    });

    expect(plan.entryPrice).toBeCloseTo(1.105);
    expect(plan.stopPrice).toBeCloseTo(1.0999);
    expect(plan.targetPrice).toBeCloseTo(1.1152, 4);
    expect(plan.riskDistance).toBeCloseTo(0.0051, 4);
    expect(plan.sameCandleResolution).toBe('STOP_LOSS_FIRST');
  });

  test('expires when entry is never reached inside the entry window', () => {
    const candidate = buildCandidate();
    const future = Array.from({ length: 4 }, (_, i) => candle(20000 + i * 900000, 1.12, 1.13, 1.119, 1.125));

    const result = evaluateOutcome(candidate, future, { entryWindowBars: 4, maxHoldBars: 8 });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome?.outcomeType).toBe('EXPIRED');
    expect(result.outcome?.reason.code).toBe('ENTRY_WINDOW_EXPIRED');
    expect(result.entryTriggeredAt).toBeNull();
  });

  test('records entry and take profit from subsequent candles only', () => {
    const candidate = buildCandidate();
    const future = [
      candle(20000, 1.12, 1.125, 1.106, 1.115),
      candle(920000, 1.115, 1.116, 1.11, 1.114),
      candle(1820000, 1.114, 1.116, 1.112, 1.115),
      candle(2720000, 1.115, 1.12, 1.114, 1.119),
    ];

    const result = evaluateOutcome(candidate, future, { entryWindowBars: 4, maxHoldBars: 8 });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome?.outcomeType).toBe('TAKE_PROFIT');
    expect(result.entryTriggeredAt).toBe(20000);
    expect(result.entryPrice).toBeCloseTo(1.105);
    expect(result.rrAchieved).toBeCloseTo(2, 5);
  });

  test('does not use the entry candle itself for stop or target resolution', () => {
    const candidate = buildCandidate();
    const future = [
      candle(20000, 1.105, 1.116, 1.099, 1.108),
      candle(920000, 1.108, 1.11, 1.106, 1.109),
    ];

    const result = evaluateOutcome(candidate, future, { entryWindowBars: 4, maxHoldBars: 8 });

    expect(result.status).toBe('OPEN');
    expect(result.outcome).toBeNull();
    expect(result.entryTriggeredAt).toBe(20000);
  });

  test('records stop loss before target when one post-entry OHLC candle touches both levels', () => {
    const candidate = buildCandidate();
    const future = [
      candle(20000, 1.105, 1.106, 1.104, 1.105),
      candle(920000, 1.105, 1.116, 1.099, 1.108),
    ];

    const result = evaluateOutcome(candidate, future, { entryWindowBars: 4, maxHoldBars: 8 });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome?.outcomeType).toBe('STOP_LOSS');
    expect(result.rrAchieved).toBe(-1);
  });

  test('keeps a completed signal until durable outcome evidence is acknowledged', () => {
    const fs = require('fs');
    const path = require('path');
    const stateFile = path.join(process.cwd(), 'data', `outcome-test-${Date.now()}.json`);
    try {
      const tracker = new MarketDataOutcomeTracker({ stateFile });
      const candidate = buildCandidate();
      tracker.register(candidate);
      expect(tracker.has(candidate.signalId!)).toBe(true);

      const future = [candle(20000, 1.105, 1.106, 1.104, 1.105), candle(920000, 1.105, 1.116, 1.104, 1.115)];
      const results = tracker.process('EURUSD', future, { entryWindowBars: 4, maxHoldBars: 8 });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('COMPLETED');
      expect(tracker.has(candidate.signalId!)).toBe(true);
      expect(tracker.acknowledgeCompleted(candidate.signalId!)).toBe(true);
      expect(tracker.has(candidate.signalId!)).toBe(false);
    } finally {
      try { fs.unlinkSync(stateFile); } catch {}
    }
  });
});
