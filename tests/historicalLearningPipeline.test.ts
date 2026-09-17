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

function outcome(signalId: string, timestamp: number, type: 'TP' | 'SL') {
  return {
    evidenceSchemaVersion: 1,
    signalId,
    appendedAt: new Date(timestamp).toISOString(),
    outcome: {
      type,
      holdingTimeMs: 1800000,
      rrAchieved: type === 'TP' ? 2 : -1,
      maximumFavorableExcursion: type === 'TP' ? 22 : 5,
      maximumAdverseExcursion: type === 'TP' ? 4 : 12,
      exitTimestamp: timestamp,
      exitReason: type === 'TP' ? 'Target reached.' : 'Stop reached.',
    },
  };
}

test('builds a validated dataset from matched signal and outcome evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-learning-'));
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
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(signalsFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(outcomesFile), { recursive: true, force: true });
  }
});

test('historical learning report is generated from evidence rather than runtime grade math', () => {
  const signalsFile = writeFixture([signal('S1', 1700000000000, 'A'), signal('S2', 1700000900000, 'A+')]);
  const outcomesFile = writeFixture([outcome('S1', 1700001800000, 'TP'), outcome('S2', 1700002700000, 'SL')]);
  try {
    const result = generateHistoricalLearningReport({ signalsFile, outcomesFile });
    expect(result.dataset.items).toHaveLength(2);
    expect(result.segmentedBenchmark.metadata.datasetFingerprint).not.toMatch(/^runtime:/);
    expect(result.learningReport.metadata.datasetFingerprint).toBe(result.segmentedBenchmark.metadata.datasetFingerprint);
    expect(result.learningReport.overallLearning.learnedPatterns).toBe(0);
  } finally {
    fs.rmSync(path.dirname(signalsFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(outcomesFile), { recursive: true, force: true });
  }
});
