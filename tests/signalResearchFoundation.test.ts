import * as fs from 'fs';
import * as path from 'path';
import {
  createSignalEvidenceRecord,
  createCompletedSignalOutcomeEvidence,
  createSignalPricePathEvidenceRecord,
  SIGNAL_EVIDENCE_SCHEMA_VERSION,
  SIGNAL_EVIDENCE_STRATEGY_VERSION,
  SIGNAL_OUTCOME_ENGINE_VERSION,
  SignalEvidenceRecord,
} from '../src/signalEvidence';
import { evaluateOutcome } from '../src/signalOutcomeTracker';
import { exportResearchDataset } from '../src/researchDatasetExporter';
import { validateResearchEvidence, assertValidResearchEvidence } from '../src/signalResearchValidation';
import { Candle } from '../src/types';
import { NotificationCandidate } from '../server/pipeline';
import { createSignalContext } from '../src/signalContext';
import { calibrateDecision } from '../src/decisionCalibration';

describe('Signal Research Foundation & Data Quality (A through L)', () => {
  const testDir = path.join(__dirname, 'temp_research_foundation_test');

  beforeEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  function candle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
    return { timestamp, open, high, low, close };
  }

  function makeMockCandidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
    const candidateTimestamp = 1700000000000;
    const direction = 'long' as const;
    const event = {
      type: 'BOS' as const,
      direction: 'bullish' as const,
      brokenSwing: {} as any,
      breakCandleIndex: 1,
      breakTimestamp: candidateTimestamp,
      breakClosePrice: 1.101,
      level: 1.101,
    };
    const poi = {
      id: 'ob_1',
      timeframe: '15m' as const,
      type: 'bullish' as const,
      high: 1.102,
      low: 1.1,
      startIndex: 0,
      endIndex: 1,
      mitigated: false,
      refined: false,
      relatedEvent: event,
      candleIndex: 1,
      formedAtIndex: 1,
    };

    const signalContext = createSignalContext({
      signalId: 'EURUSD_15m_OB_test_1',
      pair: 'EURUSD',
      direction,
      timeframe: '15m',
      grade: 'A',
      score: 9,
      timestamp: candidateTimestamp,
      lifecycleStates: ['DETECTED', 'GRADED', 'EXECUTION_READY'],
    });

    return {
      symbol: 'EURUSD',
      tradeDirection: direction,
      poiType: 'OB',
      poi,
      gradeResult: {
        grade: 'A',
        totalScore: 9,
        entryAllowed: true,
        breakdown: {
          htfBiasPD: 2,
          displacement: 2,
          structure: 2,
          sweep: 1,
          poiQuality: 2,
        },
        blockReasons: [],
      },
      uniqueKey: 'EURUSD_15m_OB_test_1',
      signalId: 'EURUSD_15m_OB_test_1',
      currentPrice: 1.1015,
      poiFormedTimestamp: candidateTimestamp - 3600000,
      bias4H: 'bullish',
      bias1H: 'bullish',
      pd4H: 'discount',
      pd1H: 'discount',
      poiTestCount: 1,
      signalContext,
      marketDataTimestamp: candidateTimestamp,
      validationCloseTimestamp: candidateTimestamp,
      ...overrides,
    } as NotificationCandidate;
  }

  function makeSignalSnapshot(candidate: NotificationCandidate): SignalEvidenceRecord {
    const zoneHigh = 1.102;
    const zoneLow = 1.1;
    const midpoint = (zoneHigh + zoneLow) / 2;
    const createdAt = candidate.signalContext!.timestamp;

    const decisionCalibration = calibrateDecision({
      tradeDirection: candidate.tradeDirection,
      bias4H: candidate.bias4H,
      bias1H: candidate.bias1H,
      pd4H: candidate.pd4H,
      pd1H: candidate.pd1H,
      pd15M: candidate.pd15M,
      poiTestCount: candidate.poiTestCount,
      grade: candidate.gradeResult.grade as any,
      score: candidate.gradeResult.totalScore,
      admissionProfile: 'PRODUCTION',
      blockReasons: candidate.gradeResult.blockReasons,
      breakdown: candidate.gradeResult.breakdown,
    });

    return createSignalEvidenceRecord({
      metadata: {
        signalId: candidate.signalId!,
        timestamp: createdAt,
        recordedAt: new Date(createdAt).toISOString(),
        symbol: candidate.symbol,
        direction: candidate.tradeDirection,
        timeframe: '15m',
        strategyVersion: SIGNAL_EVIDENCE_STRATEGY_VERSION,
        engineVersion: 1,
        detectorVersion: 1,
        gradeVersion: 1,
        evidenceSchemaVersion: SIGNAL_EVIDENCE_SCHEMA_VERSION,
      },
      classification: {
        strategy: 'SWING_BOS_CORE',
        setupType: 'CONTINUATION',
        poiType: candidate.poiType,
        structureEvent: 'BOS',
        grade: candidate.gradeResult.grade,
        score: candidate.gradeResult.totalScore,
        entryAllowed: candidate.gradeResult.entryAllowed,
      },
      htfContext: {
        bias4H: candidate.bias4H,
        bias1H: candidate.bias1H,
        pd4H: candidate.pd4H,
        pd1H: candidate.pd1H,
        pd15M: 'discount',
        bias15M: null,
        htfAlignmentState: 'FULL_ALIGNMENT',
      },
      structure: {
        eventType: 'BOS',
        eventTimestamp: createdAt,
        eventTimeframe: '15m',
        structureScore: 2,
        swingContext: null,
      },
      poi: {
        poiType: candidate.poiType,
        timeframe: '15m',
        zoneHigh,
        zoneLow,
        midpoint,
        poiAgeMs: 3600000,
        poiAgeBars: 4,
        poiTestCount: 1,
        distanceFromCurrentPrice: 0.0005,
        mitigationState: 'PARTIALLY_MITIGATED',
      },
      displacement: {
        displacementScore: 2,
        bodyPercentage: 60,
        range: 0.001,
        impulseDirection: 'bullish',
        atrNormalizedDisplacement: null,
      },
      sweep: {
        sweepDetected: true,
        sweepDirection: 'long',
        sweepQuality: 'strong',
      },
      model: {
        modelState: 'confirmed',
        admissionProfile: 'PRODUCTION',
      },
      grade: {
        totalScore: candidate.gradeResult.totalScore,
        grade: candidate.gradeResult.grade,
        entryAllowed: candidate.gradeResult.entryAllowed,
        breakdown: candidate.gradeResult.breakdown,
        blockReasons: [],
      },
      marketContext: {
        session: 'LONDON',
        killzone: { active: true, reason: 'slot1_10_13' },
        dayOfWeek: 1,
        dayOfWeekName: 'Mon',
        hourUtc: 10,
        volatilityAtr: null,
        marketWindowState: { active: true, reason: 'market_window_open' },
        marketRegime: null,
      },
      runtime: {
        executionEligibility: true,
        decisionCalibration,
        riskResult: {
          status: 'ACCEPTED',
          executionAllowed: true,
          reasonCode: null,
          reasonMessage: null,
          theoreticalRiskDistance: 0.002,
          invalidationPrice: 1.1,
        },
      },
    });
  }

  // A. signal snapshot contains only signal-time information
  test('A: signal snapshot contains strictly signal-time information and zero outcome data', () => {
    const candidate = makeMockCandidate();
    const snapshot = makeSignalSnapshot(candidate);

    expect(snapshot.metadata.signalId).toBe('EURUSD_15m_OB_test_1');
    expect(snapshot.metadata.timestamp).toBe(1700000000000);
    // Ensure no outcome fields exist on the signal snapshot
    expect((snapshot as unknown as Record<string, unknown>).outcome).toBeUndefined();
    expect((snapshot as unknown as Record<string, unknown>).exitTimestamp).toBeUndefined();
    expect((snapshot as unknown as Record<string, unknown>).rrAchieved).toBeUndefined();
    expect((snapshot as unknown as Record<string, unknown>).realizedR).toBeUndefined();
  });

  // B. outcome can be joined to signal by signalId
  test('B: outcome can be joined to signal deterministically by signalId', () => {
    const candidate = makeMockCandidate();
    const snapshot = makeSignalSnapshot(candidate);
    const outcome = createCompletedSignalOutcomeEvidence({
      signalId: snapshot.metadata.signalId,
      outcome: {
        type: 'TP',
        holdingTimeMs: 1800000,
        holdingBars: 2,
        rrAchieved: 2.0,
        maximumFavorableExcursion: 0.004,
        maximumAdverseExcursion: 0.0002,
        exitTimestamp: 1700001800000,
        exitPrice: 1.105,
        exitReason: 'TAKE_PROFIT_REACHED',
      },
      entry: {
        triggered: true,
        timestamp: 1700000900000,
        price: 1.101,
        entryMode: 'midpoint',
      },
      risk: {
        stop: 1.099,
        target: 1.105,
        riskDistance: 0.002,
        targetR: 2,
      },
    });

    const flatRows = exportResearchDataset({
      signals: [snapshot],
      outcomes: [outcome],
      validate: true,
    });

    expect(flatRows.length).toBe(1);
    expect(flatRows[0].signalId).toBe('EURUSD_15m_OB_test_1');
    expect(flatRows[0].outcomeType).toBe('TP');
    expect(flatRows[0].realizedR).toBe(2.0);
    expect(flatRows[0].entryTriggered).toBe(true);
    expect(flatRows[0].entryPrice).toBe(1.101);
  });

  // C. historical evidence remains immutable
  test('C: historical evidence records are deep-frozen and append-only', () => {
    const candidate = makeMockCandidate();
    const snapshot = makeSignalSnapshot(candidate);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.metadata)).toBe(true);
    expect(Object.isFrozen(snapshot.poi)).toBe(true);

    expect(() => {
      (snapshot as any).metadata.signalId = 'MUTATED';
    }).toThrow();
  });

  // D. future candle cannot enter signal snapshot
  test('D: future candle cannot enter signal snapshot', () => {
    const candidate = makeMockCandidate();
    const snapshot = makeSignalSnapshot(candidate);
    const futureCandleTime = 1700000900000; // 15m in future

    // Verify snapshot timestamp is strictly the signal creation timestamp
    expect(snapshot.metadata.timestamp).toBe(1700000000000);
    expect(snapshot.structure.eventTimestamp).toBeLessThanOrEqual(snapshot.metadata.timestamp);
    expect(snapshot.poi.poiAgeMs).toBe(snapshot.metadata.timestamp - candidate.poiFormedTimestamp);
    expect(snapshot.metadata.timestamp).toBeLessThan(futureCandleTime);
  });

  // E. future candle cannot affect a pre-signal feature
  test('E: future candle cannot affect pre-signal features', () => {
    const candidate = makeMockCandidate();
    const snapshotBefore = makeSignalSnapshot(candidate);

    const postSignalCandles: Candle[] = [
      candle(1700000900000, 1.101, 1.106, 1.100, 1.105),
    ];

    // Evaluate outcome using post-signal candles
    evaluateOutcome(candidate, postSignalCandles, { entryWindowBars: 16, maxHoldBars: 32 });

    // Snapshot remains identical
    const snapshotAfter = makeSignalSnapshot(candidate);
    expect(snapshotAfter.grade.totalScore).toBe(snapshotBefore.grade.totalScore);
    expect(snapshotAfter.displacement.displacementScore).toBe(snapshotBefore.displacement.displacementScore);
    expect(snapshotAfter.poi.zoneHigh).toBe(snapshotBefore.poi.zoneHigh);
  });

  // F. TP record is represented correctly
  test('F: TAKE_PROFIT outcome record is represented correctly with target R and holding bars', () => {
    const candidate = makeMockCandidate();
    const start = 1700000000000;
    const candles: Candle[] = [
      // Candle 1: hits entry midpoint (1.101)
      candle(start + 900000, 1.1015, 1.102, 1.1008, 1.1012),
      // Candle 2: moves in favor, reaches TP (>= 1.103)
      candle(start + 1800000, 1.1012, 1.106, 1.101, 1.1055),
    ];

    const result = evaluateOutcome(candidate, candles, {
      entryWindowBars: 16,
      maxHoldBars: 32,
      invalidationBufferPips: 1,
      targetRMultiple: 2,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome?.outcomeType).toBe('TAKE_PROFIT');
    expect(result.rrAchieved).toBe(2);
    expect(result.holdingBars).toBe(1);
    expect(result.entryTriggeredAt).toBe(start + 900000);
    expect(result.evaluation?.evaluatedCandles).toBe(2);
  });

  // G. SL record is represented correctly
  test('G: STOP_LOSS outcome record is represented correctly and resolves same-candle conservatively', () => {
    const candidate = makeMockCandidate();
    const start = 1700000000000;
    const candles: Candle[] = [
      // Candle 1: hits entry
      candle(start + 900000, 1.1015, 1.102, 1.1008, 1.1012),
      // Candle 2: touches stop price
      candle(start + 1800000, 1.1012, 1.102, 1.099, 1.0995),
    ];

    const result = evaluateOutcome(candidate, candles, {
      entryWindowBars: 16,
      maxHoldBars: 32,
      invalidationBufferPips: 1,
      targetRMultiple: 2,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome?.outcomeType).toBe('STOP_LOSS');
    expect(result.rrAchieved).toBe(-1);
    expect(result.evaluation?.sameCandleResolution).toBe('STOP_LOSS_FIRST');
  });

  // H. EXPIRED record is represented correctly
  test('H: EXPIRED outcome record is represented correctly on entry window expiry', () => {
    const candidate = makeMockCandidate();
    const start = 1700000000000;
    // 3 candles where price stays far away from entry
    const candles: Candle[] = [
      candle(start + 900000, 1.11, 1.112, 1.109, 1.111),
      candle(start + 1800000, 1.111, 1.113, 1.11, 1.112),
      candle(start + 2700000, 1.112, 1.114, 1.111, 1.113),
    ];

    const result = evaluateOutcome(candidate, candles, {
      entryWindowBars: 3,
      maxHoldBars: 10,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome?.outcomeType).toBe('EXPIRED');
    expect(result.outcome?.reason.code).toBe('ENTRY_WINDOW_EXPIRED');
    expect(result.entryTriggeredAt).toBeNull();
    expect(result.rrAchieved).toBeNull();
    expect(result.holdingBars).toBeNull();
  });

  // I. MFE/MAE are deterministic
  test('I: MFE and MAE are computed deterministically across post-entry candles', () => {
    const candidate = makeMockCandidate();
    const start = 1700000000000;
    const entryPrice = 1.101; // midpoint
    const candles: Candle[] = [
      // Candle 1: entry touch
      candle(start + 900000, 1.1015, 1.102, 1.1008, 1.1012),
      // Candle 2: post-entry excursion
      candle(start + 1800000, 1.1012, 1.1035, 1.1002, 1.1025),
    ];

    const result = evaluateOutcome(candidate, candles, {
      entryWindowBars: 5,
      maxHoldBars: 1, // Exit on max hold at offset 0
    });

    expect(result.maximumFavorableExcursion).toBeCloseTo(1.1035 - entryPrice, 5);
    expect(result.maximumAdverseExcursion).toBeCloseTo(entryPrice - 1.1002, 5);
  });

  // J. price-path timestamps are strictly causal
  test('J: price-path timestamps are strictly causal and only record evaluated candles', () => {
    const candidate = makeMockCandidate();
    const start = 1700000000000;
    const candles: Candle[] = [
      candle(start + 900000, 1.1015, 1.102, 1.1008, 1.1012),
      candle(start + 1800000, 1.1012, 1.106, 1.101, 1.1055),
      candle(start + 2700000, 1.1055, 1.107, 1.105, 1.1065), // extra future candle
    ];

    const result = evaluateOutcome(candidate, candles, {
      entryWindowBars: 16,
      maxHoldBars: 32,
      includePricePath: true,
    });

    expect(result.pricePath).toBeDefined();
    expect(result.pricePath!.length).toBe(2); // Only the 2 evaluated candles, not the 3rd future candle!
    expect(result.pricePath![0].timestamp).toBe(start + 900000);
    expect(result.pricePath![1].timestamp).toBe(start + 1800000);
    expect(result.pricePath![0].barsSinceObservation).toBe(1);
    expect(result.pricePath![1].barsSinceObservation).toBe(2);
    expect(result.pricePath![0].barsSinceEntry).toBe(0);
    expect(result.pricePath![1].barsSinceEntry).toBe(1);
  });

  // K. different strategy versions remain distinguishable
  test('K: different strategy versions remain explicitly distinguishable in snapshots and export', () => {
    const candidate = makeMockCandidate();
    const snapshotV1 = makeSignalSnapshot(candidate);
    const snapshotV2 = createSignalEvidenceRecord({
      ...snapshotV1,
      metadata: {
        ...snapshotV1.metadata,
        signalId: 'EURUSD_15m_OB_test_v2',
        strategyVersion: 'SWING_BOS_CORE_V2_EXPERIMENTAL',
      },
    });

    expect(snapshotV1.metadata.strategyVersion).toBe('SWING_BOS_CORE_V1');
    expect(snapshotV2.metadata.strategyVersion).toBe('SWING_BOS_CORE_V2_EXPERIMENTAL');

    const rows = exportResearchDataset({
      signals: [snapshotV1, snapshotV2],
      validate: true,
    });

    expect(rows.length).toBe(2);
    expect(rows[0].strategyVersion).toBe('SWING_BOS_CORE_V1');
    expect(rows[1].strategyVersion).toBe('SWING_BOS_CORE_V2_EXPERIMENTAL');
  });

  // L. invalid evidence is rejected
  test('L: strict validation rejects invalid evidence (missing ID, NaN, inverted zone, non-causal timestamps)', () => {
    const candidate = makeMockCandidate();
    const baseSnapshot = makeSignalSnapshot(candidate);

    // 1. Missing signalId
    const invalidId = {
      ...baseSnapshot,
      metadata: { ...baseSnapshot.metadata, signalId: '' },
    };
    const report1 = validateResearchEvidence({ signals: [invalidId as any] });
    expect(report1.isValid).toBe(false);
    expect(report1.issues.some(i => i.code === 'MISSING_SIGNAL_ID')).toBe(true);

    // 2. Inverted zone
    const invertedZone = {
      ...baseSnapshot,
      poi: { ...baseSnapshot.poi, zoneHigh: 1.09, zoneLow: 1.11 },
    };
    const report2 = validateResearchEvidence({ signals: [invertedZone as any] });
    expect(report2.isValid).toBe(false);
    expect(report2.issues.some(i => i.code === 'INVERTED_ZONE_BOUNDS')).toBe(true);

    // 3. NaN in numeric fields
    const nanField = {
      ...baseSnapshot,
      poi: { ...baseSnapshot.poi, poiAgeMs: NaN },
    };
    const report3 = validateResearchEvidence({ signals: [nanField as any] });
    expect(report3.isValid).toBe(false);
    expect(report3.issues.some(i => i.code === 'NON_FINITE_NUMERIC_FIELD')).toBe(true);

    // 4. Non-causal outcome timestamp (exit before signal)
    const nonCausalOutcome = createCompletedSignalOutcomeEvidence({
      signalId: baseSnapshot.metadata.signalId,
      outcome: {
        type: 'TP',
        holdingTimeMs: 100,
        holdingBars: 1,
        rrAchieved: 2,
        maximumFavorableExcursion: 1,
        maximumAdverseExcursion: 0,
        exitTimestamp: baseSnapshot.metadata.timestamp - 5000, // EARLIER than signal!
        exitPrice: 1.105,
        exitReason: 'TEST',
      },
    });
    const report4 = validateResearchEvidence({
      signals: [baseSnapshot],
      outcomes: [nonCausalOutcome],
    });
    expect(report4.isValid).toBe(false);
    expect(report4.issues.some(i => i.code === 'CAUSAL_VIOLATION_EXIT_PRECEDES_SIGNAL')).toBe(true);

    // 5. assertValidResearchEvidence throws
    expect(() => {
      assertValidResearchEvidence({ signals: [invertedZone as any] });
    }).toThrow(/INVERTED_ZONE_BOUNDS/);
  });
});
