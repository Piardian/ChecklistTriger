import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildHistoricalLearningDataset } from '../src/historicalLearningAdapter';
import { generateHistoricalLearningReport } from '../src/historicalLearningPipeline';

function writeFixture(lines: object[]): string {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-learning-')), 'evidence.jsonl');
  fs.writeFileSync(filePath, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  return filePath;
}

function signal(signalId: string, timestamp: number, grade: 'A+' | 'A' = 'A') {
  return {
    evidenceSchemaVersion: 1,
    metadata: {
      signalId,
      timestamp,
      recordedAt: new Date(timestamp).toISOString(),
      symbol: 'EURUSD',
      direction: 'long',
      timeframe: '15m',
      engineVersion: 1,
      detectorVersion: 1,
      gradeVersion: 1,
    },
    htfContext: { bias4H: 'bullish', bias1H: 'bullish', pd4H: 'discount', pd1H: 'discount', pd15M: 'discount' },
    structure: { eventType: 'BOS', eventTimestamp: timestamp, eventTimeframe: '15m', structureScore: 2 },
    poi: { poiType: 'OB', timeframe: '15m', zoneHigh: 1.11, zoneLow: 1.10, poiAgeMs: 900000, poiTestCount: 0 },
    displacement: { displacementScore: 2, bodyPercentage: 70, range: 0.001, impulseDirection: 'bullish' },
    sweep: { sweepDetected: true, sweepDirection: 'long', sweepQuality: 'strong' },
    model: { modelState: 'confirmed', admissionProfile: 'PRODUCTION' },
    grade: {
      totalScore: grade === 'A+' ? 9 : 8,
      grade,
      entryAllowed: true,
      breakdown: { htfBiasPD: 2, displacement: 2, structure: 2, sweep: 1, poiQuality: 1 },
      blockReasons: [],
    },
    signalQuality: {
      version: 1,
      score: 80,
      confidence: 80,
      status: 'excellent',
      metrics: { barsSinceFormation: 2, barsSinceBreak: 1, distanceToPoiPips: 2, poiRelation: 'inside', poiTestCount: 0, isFresh: true, isNearPoi: true, invalidationRisk: 'low' },
      marketContext: { session: 'london', killzone: true, dayOfWeek: 2, hourTR: 10 },
      reasons: [],
      warnings: [],
    },
    runtime: { executionEligibility: true, decisionCalibration: {} as any, riskResult: { status: 'ACCEPTED', executionAllowed: true, reasonCode: null, reasonMessage: null } },
  };
}

function outcome(signalId: string, timestamp: number, type: 'TP' | 'SL' | 'MANUAL' | 'CANCELLED') {
  return {
    evidenceSchemaVersion: 1,
    signalId,
    appendedAt: new Date(timestamp).toISOString(),
    outcome: {
      type,
      holdingTimeMs: 1800000,
      rrAchieved: type === 'TP' ? 2 : type === 'SL' ? -1 : null,
      maximumFavorableExcursion: type === 'TP' ? 22 : 5,
      maximumAdverseExcursion: type === 'TP' ? 4 : 12,
      exitTimestamp: timestamp,
      exitReason: type === 'TP' ? 'Target reached.' : type === 'SL' ? 'Stop reached.' : `${type} outcome.`,
    },
  };
}

test('builds a validated dataset from matched signal and outcome evidence', () => {
  const signalsFile = writeFixture([signal('S1', 1700000000000, 'A'), signal('S2', 1700000900000, 'A+')]);
  const outcomesFile = writeFixture([outcome('S1', 1700001800000, 'TP')]);
  try {
    const result = buildHistoricalLearningDataset({ signalsFile, outcomesFile });
    expect(result.validationReport.valid).toBe(true);
    expect(result.dataset.items).toHaveLength(1);
    expect(result.dataset.items[0].candidateId).toBe('S1');
    expect(result.dataset.items[0].outcome.outcomeStatus).toBe('TP');
    expect(result.dataset.coverage.snapshotCount).toBe(2);
    expect(result.dataset.coverage.labeledCount).toBe(1);
    expect(result.dataset.coverage.missingOutcomeCount).toBe(1);
    expect(result.dataset.coverage.coverageRate).toBe(0.5);
  } finally {
    fs.rmSync(path.dirname(signalsFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(outcomesFile), { recursive: true, force: true });
  }
});

test('historical learning uses an ordered and purged train split with separate OOS validation', () => {
  const base = 1700000000000;
  const signals = Array.from({ length: 40 }, (_, index) => signal(`S${index + 1}`, base + index * 900000, index % 2 === 0 ? 'A' : 'A+'));
  const outcomes = signals.map((item, index) => outcome(item.metadata.signalId, base + index * 900000 + 1800000, index % 2 === 0 ? 'TP' : 'SL'));
  const signalsFile = writeFixture(signals);
  const outcomesFile = writeFixture(outcomes);
  try {
    const result = generateHistoricalLearningReport({ signalsFile, outcomesFile });
    expect(result.dataset.items).toHaveLength(40);
    expect(result.temporalSplit).toBeDefined();
    expect(result.temporalSplit?.rawTrainCandidateCount).toBe(28);
    expect(result.temporalSplit?.purgedTrainCount).toBe(2);
    expect(result.temporalSplit?.train.items).toHaveLength(26);
    expect(result.temporalSplit?.outOfSample.items).toHaveLength(12);
    expect(result.temporalSplit?.trainCutoffTimestamp).toBe(result.temporalSplit?.train.items[result.temporalSplit.train.items.length - 1].snapshot.timestamp);
    expect(result.temporalSplit?.train.items[result.temporalSplit.train.items.length - 1].outcome.metadata.endTimestamp).toBeLessThan(
      Date.parse(result.temporalSplit?.outOfSampleStartTimestamp ?? '')
    );
    expect(result.learningReport.metadata.datasetFingerprint).toBe(result.segmentedBenchmark.metadata.datasetFingerprint);
    expect(result.learningReport.metadata.generatedAtDatasetCoverage).toBe(1);
    expect(result.outOfSampleSegmentedBenchmark?.metadata.generatedAtDatasetCoverage).toBe(1);
    expect(result.outOfSampleValidation.outOfSampleSampleSize).toBe(12);
  } finally {
    fs.rmSync(path.dirname(signalsFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(outcomesFile), { recursive: true, force: true });
  }
});

test('preserves low source coverage so learning does not hide incomplete outcomes', () => {
  const base = 1700000000000;
  const signals = Array.from({ length: 40 }, (_, index) => signal(`S${index + 1}`, base + index * 900000, 'A'));
  const outcomes = signals.slice(0, 30).map((item, index) => outcome(item.metadata.signalId, base + index * 900000 + 1800000, 'TP'));
  const signalsFile = writeFixture(signals);
  const outcomesFile = writeFixture(outcomes);
  try {
    const result = generateHistoricalLearningReport({ signalsFile, outcomesFile });
    expect(result.dataset.items).toHaveLength(30);
    expect(result.dataset.coverage.coverageRate).toBe(0.75);
    expect(result.learningReport.metadata.generatedAtDatasetCoverage).toBe(0.75);
    expect(result.learningReport.patterns).toHaveLength(0);
    expect(result.learningReport.warnings[0].type).toBe('LOW_COVERAGE');
  } finally {
    fs.rmSync(path.dirname(signalsFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(outcomesFile), { recursive: true, force: true });
  }
});

test('excludes manual and cancelled lifecycle outcomes from benchmark learning labels', () => {
  const base = 1700000000000;
  const signalsFile = writeFixture([signal('S1', base), signal('S2', base + 900000), signal('S3', base + 1800000)]);
  const outcomesFile = writeFixture([
    outcome('S1', base + 1800000, 'MANUAL'),
    outcome('S2', base + 2700000, 'CANCELLED'),
    outcome('S3', base + 3600000, 'TP'),
  ]);
  try {
    const result = buildHistoricalLearningDataset({ signalsFile, outcomesFile });
    expect(result.dataset.items).toHaveLength(1);
    expect(result.dataset.items[0].candidateId).toBe('S3');
    expect(result.skippedOutcomeCount).toBe(2);
    expect(result.dataset.coverage).toEqual({
      snapshotCount: 3,
      labeledCount: 1,
      missingOutcomeCount: 2,
      coverageRate: 1 / 3,
    });
  } finally {
    fs.rmSync(path.dirname(signalsFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(outcomesFile), { recursive: true, force: true });
  }
});
