import {
  calculateCeEntry,
  calculateDynamicStopBuffer,
  isSliceThroughCandle,
  evaluateEntryCandleReaction,
} from '../src/entryMechanics';
import { evaluateOutcome, buildResearchOutcomePlan } from '../src/signalOutcomeTracker';
import type { Candle } from '../src/types';
import type { NotificationCandidate } from '../server/pipeline';

describe('SMC Model A Entry Mechanics (CLT / swing-bos-core)', () => {
  describe('calculateCeEntry', () => {
    test('calculates 50% CE midpoint entry correctly for Long', () => {
      const plan = calculateCeEntry({
        direction: 'long',
        zoneLow: 1.0500,
        zoneHigh: 1.0540,
        symbol: 'EURUSD',
        entryModel: 'midpoint',
        targetRMultiple: 2.0,
      });

      // 50% CE = 1.0500 + 0.0040 * 0.5 = 1.0520
      expect(plan.entryPrice).toBeCloseTo(1.0520, 5);
      expect(plan.isLimit).toBe(true);
      // For EURUSD: dynamic buffer is at least 2.0 pips (0.00020)
      expect(plan.stopPrice).toBeLessThan(1.0500);
      expect(plan.riskDistance).toBeCloseTo(plan.entryPrice - plan.stopPrice, 5);
      expect(plan.tp1Price).toBeCloseTo(plan.entryPrice + plan.riskDistance * 1.0, 5);
      expect(plan.tp2Price).toBeCloseTo(plan.entryPrice + plan.riskDistance * 2.0, 5);
    });

    test('calculates 50% CE midpoint entry correctly for Short', () => {
      const plan = calculateCeEntry({
        direction: 'short',
        zoneLow: 1.1000,
        zoneHigh: 1.1050,
        symbol: 'EURUSD',
        entryModel: 'midpoint',
        targetRMultiple: 3.0,
      });

      // 50% CE = 1.1000 + 0.0050 * 0.5 = 1.1025
      expect(plan.entryPrice).toBeCloseTo(1.1025, 5);
      expect(plan.stopPrice).toBeGreaterThan(1.1050);
      expect(plan.riskDistance).toBeCloseTo(plan.stopPrice - plan.entryPrice, 5);
      expect(plan.tp1Price).toBeCloseTo(plan.entryPrice - plan.riskDistance * 1.0, 5);
      expect(plan.tp3Price).toBeCloseTo(plan.entryPrice - plan.riskDistance * 3.0, 5);
    });

    test('supports legacy zone_touch (edge) entry mode', () => {
      const longEdge = calculateCeEntry({
        direction: 'long',
        zoneLow: 1.0500,
        zoneHigh: 1.0540,
        symbol: 'EURUSD',
        entryModel: 'zone_touch',
      });
      expect(longEdge.entryPrice).toBeCloseTo(1.0540, 5);

      const shortEdge = calculateCeEntry({
        direction: 'short',
        zoneLow: 1.0500,
        zoneHigh: 1.0540,
        symbol: 'EURUSD',
        entryModel: 'zone_touch',
      });
      expect(shortEdge.entryPrice).toBeCloseTo(1.0500, 5);
    });
  });

  describe('calculateDynamicStopBuffer', () => {
    test('scales buffer correctly across asset classes', () => {
      const eurusdBuf = calculateDynamicStopBuffer('EURUSD', 1.0500, 1.0520);
      expect(eurusdBuf).toBeGreaterThanOrEqual(0.0002); // >= 2.0 pips

      const goldBuf = calculateDynamicStopBuffer('XAUUSD', 2600.0, 2610.0);
      expect(goldBuf).toBeGreaterThanOrEqual(1.50); // Gold min $1.50

      const btcBuf = calculateDynamicStopBuffer('BTCUSD', 65000.0, 65500.0);
      expect(btcBuf).toBeGreaterThanOrEqual(35.0); // BTC min $35
    });
  });

  describe('isSliceThroughCandle', () => {
    test('identifies strong momentum candle breaching zone without counter-wick', () => {
      // Long scenario: zone is 1.0500 - 1.0540.
      // Candle opens at 1.0510 (above zoneLow), plummets to close at 1.0470, low 1.0465.
      // Huge body (40 pips), tiny wick (5 pips), breached zoneLow.
      const sliceCandle: Candle = {
        timestamp: 1000,
        open: 1.0510,
        high: 1.0515,
        low: 1.0465,
        close: 1.0470,
      };

      expect(isSliceThroughCandle('long', sliceCandle, 1.0500, 1.0540)).toBe(true);
    });

    test('does not flag candle that shows strong defensive rejection wick', () => {
      // Candle sweeps down through 1.0500 to 1.0480, but buyers push it back up to close at 1.0505
      const rejectionCandle: Candle = {
        timestamp: 2000,
        open: 1.0510,
        high: 1.0515,
        low: 1.0480,
        close: 1.0505,
      };

      // Did not close below zoneLow
      expect(isSliceThroughCandle('long', rejectionCandle, 1.0500, 1.0540)).toBe(false);
    });
  });

  describe('evaluateOutcome integration', () => {
    const buildTestCandidate = (): NotificationCandidate => ({
      symbol: 'EURUSD',
      tradeDirection: 'long',
      poiType: 'OB',
      poi: {
        direction: 'bullish',
        candleIndex: 10,
        high: 1.0540,
        low: 1.0500,
        formedAtIndex: 10,
        relatedEvent: {
          type: 'BOS',
          direction: 'bullish',
          brokenSwing: {} as any,
          breakCandleIndex: 12,
          breakTimestamp: 10000,
          breakClosePrice: 1.0550,
        },
      } as any,
      gradeResult: {
        totalScore: 9,
        grade: 'A+',
        entryAllowed: true,
        blockReasons: [],
        breakdown: { htfBiasPD: 2, displacement: 2, structure: 2, sweep: 2, poiQuality: 1 },
      },
      uniqueKey: 'test_cand_1',
      signalId: 'test_sig_1',
      currentPrice: 1.0550,
      bias4H: 'bullish',
      bias1H: 'bullish',
      poiTestCount: 0,
      pd4H: 'discount',
      pd1H: 'discount',
      pd15M: 'discount',
      admissionProfile: 'PRODUCTION',
      poiFormedTimestamp: 10000,
    });

    test('cancels entry when slice-through candle breaches zone with requireReaction: true', () => {
      const candidate = buildTestCandidate();
      // Future candle is a massive slice-through candle
      const future: Candle[] = [
        {
          timestamp: 20000,
          open: 1.0530,
          high: 1.0535,
          low: 1.0460,
          close: 1.0465, // Closes well below zoneLow (1.0500) with 65 pips body
        },
      ];

      const result = evaluateOutcome(candidate, future, {
        entryWindowBars: 4,
        maxHoldBars: 8,
        requireReaction: true,
      });

      // Entry should NOT be triggered due to slice-through cancellation
      expect(result.entryTriggeredAt).toBeNull();
    });

    test('invalidates trade early when stop is breached prior to valid entry', () => {
      const candidate = buildTestCandidate();
      const plan = buildResearchOutcomePlan(candidate);
      // First candle opens below stop loss
      const future: Candle[] = [
        {
          timestamp: 20000,
          open: plan.stopPrice - 0.0010,
          high: plan.entryPrice + 0.0005,
          low: plan.stopPrice - 0.0020,
          close: plan.entryPrice,
        },
      ];

      const result = evaluateOutcome(candidate, future, { entryWindowBars: 4, maxHoldBars: 8 });
      // Should not enter since candle opened past stop loss
      expect(result.entryTriggeredAt).toBeNull();
    });
  });
});
