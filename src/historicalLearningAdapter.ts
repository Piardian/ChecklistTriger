import * as fs from 'fs';
import * as path from 'path';
import { CompletedSignalOutcomeEvidence, SignalEvidenceRecord } from './signalEvidence';
import { GRADE_ENGINE_VERSION, SIGNAL_INTELLIGENCE_SNAPSHOT_VERSION, SignalIntelligenceSnapshot } from './signalIntelligenceSnapshot';
import { SIGNAL_QUALITY_RESULT_VERSION } from './signalQualityEngine';
import { OutcomeResult } from './outcomeResult';
import { ValidatedLabeledDataset, createValidatedDataset } from './validatedDataset';
import { DatasetCoverage, createValidationReport, ValidationReport } from './validationReport';

export interface HistoricalLearningAdapterOptions { signalsFile?: string; outcomesFile?: string; }
export interface HistoricalLearningReadError { file: 'signals' | 'outcomes'; line: number; message: string; }
export interface HistoricalLearningAdapterResult {
  dataset: ValidatedLabeledDataset;
  validationReport: ValidationReport;
  readErrors: readonly HistoricalLearningReadError[];
  skippedSignalCount: number;
  skippedOutcomeCount: number;
}

export function buildHistoricalLearningDataset(options: HistoricalLearningAdapterOptions = {}): HistoricalLearningAdapterResult {
  const signalsFile = path.resolve(options.signalsFile ?? process.env.SIGNAL_EVIDENCE_FILE ?? 'evidence/signals/signal-evidence.jsonl');
  const outcomesFile = path.resolve(options.outcomesFile ?? process.env.OUTCOME_EVIDENCE_FILE ?? 'evidence/outcomes/outcome-evidence.jsonl');
  const signalRead = readJsonl<SignalEvidenceRecord>(signalsFile, 'signals');
  const outcomeRead = readJsonl<CompletedSignalOutcomeEvidence>(outcomesFile, 'outcomes');
  const readErrors = [...signalRead.errors, ...outcomeRead.errors];
  const signalsById = new Map<string, SignalIntelligenceSnapshot>();
  let skippedSignalCount = 0;

  for (const signal of signalRead.records) {
    const snapshot = toSnapshot(signal);
    if (!snapshot) { skippedSignalCount += 1; continue; }
    if (signalsById.has(snapshot.candidateId)) {
      readErrors.push({ file: 'signals', line: 0, message: `Duplicate signalId ${snapshot.candidateId} found.` });
      continue;
    }
    signalsById.set(snapshot.candidateId, snapshot);
  }

  const outcomesById = new Map<string, OutcomeResult>();
  let skippedOutcomeCount = 0;
  for (const evidence of outcomeRead.records) {
    const outcome = toOutcomeResult(evidence, signalsById.get(evidence.signalId));
    if (!outcome) { skippedOutcomeCount += 1; continue; }
    if (outcomesById.has(outcome.candidateId)) {
      readErrors.push({ file: 'outcomes', line: 0, message: `Duplicate outcome for signalId ${outcome.candidateId} found.` });
      continue;
    }
    outcomesById.set(outcome.candidateId, outcome);
  }

  const snapshots = [...signalsById.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const outcomes = [...outcomesById.values()].sort((a, b) => a.labeledAt.localeCompare(b.labeledAt));
  const labeledCount = snapshots.filter(snapshot => outcomesById.has(snapshot.candidateId)).length;
  const coverage = createCoverage(snapshots.length, labeledCount);
  const validationReport = createValidationReport(
    readErrors.map(error => ({ severity: 'error' as const, code: 'READ_ERROR', message: `${error.file}:${error.line}: ${error.message}` })),
    coverage
  );
  const dataset = createValidatedDataset({ snapshots, outcomes, validationReport });
  return Object.freeze({ dataset, validationReport, readErrors: Object.freeze(readErrors), skippedSignalCount, skippedOutcomeCount });
}

function toSnapshot(record: SignalEvidenceRecord): SignalIntelligenceSnapshot | null {
  if (record.evidenceSchemaVersion !== 1 || !record.signalQuality) return null;
  if (!['EURUSD', 'GBPUSD', 'AUDUSD', 'USDCAD'].includes(record.metadata.symbol)) return null;
  if (!['long', 'short'].includes(record.metadata.direction)) return null;
  if (!['OB', 'FVG'].includes(record.poi.poiType)) return null;
  if (!['BOS', 'CHoCH'].includes(record.structure.eventType)) return null;
  return {
    snapshotVersion: SIGNAL_INTELLIGENCE_SNAPSHOT_VERSION,
    timestamp: new Date(record.metadata.timestamp).toISOString(),
    symbol: record.metadata.symbol,
    timeframe: '15m',
    candidateId: record.metadata.signalId,
    candidate: {
      poiType: record.poi.poiType,
      tradeDirection: record.metadata.direction,
      currentPrice: null,
      poiFormedTimestamp: Math.max(0, record.metadata.timestamp - record.poi.poiAgeMs),
      relatedEventType: record.structure.eventType,
      relatedEventTimestamp: record.structure.eventTimestamp,
    },
    signalQuality: record.signalQuality,
    grade: record.grade,
    engine: { signalQualityVersion: SIGNAL_QUALITY_RESULT_VERSION, gradeVersion: GRADE_ENGINE_VERSION },
  };
}

function toOutcomeResult(evidence: CompletedSignalOutcomeEvidence, snapshot: SignalIntelligenceSnapshot | undefined): OutcomeResult | null {
  if (!snapshot || evidence.evidenceSchemaVersion !== 1 || !Number.isFinite(evidence.outcome.exitTimestamp)) return null;
  const startTimestamp = new Date(snapshot.timestamp).getTime();
  const endTimestamp = evidence.outcome.exitTimestamp;
  if (!Number.isFinite(startTimestamp) || endTimestamp < startTimestamp) return null;
  const durationMs = evidence.outcome.holdingTimeMs ?? Math.max(0, endTimestamp - startTimestamp);
  const durationBars = Math.max(0, Math.round(durationMs / (15 * 60 * 1000)));
  const status: OutcomeResult['outcomeStatus'] = ['TP', 'SL', 'BE', 'EXPIRED'].includes(evidence.outcome.type)
    ? evidence.outcome.type as OutcomeResult['outcomeStatus']
    : 'UNKNOWN';
  return {
    outcomeVersion: 1,
    candidateId: evidence.signalId,
    labeledAt: evidence.appendedAt,
    outcomeStatus: status,
    completionReason: completionReasonFor(status),
    reason: { reasonCode: reasonCodeFor(status), reasonMessage: evidence.outcome.exitReason },
    metadata: {
      labelingConfigVersion: 1,
      evaluatedCandles: durationBars,
      startTimestamp,
      endTimestamp,
      resolvedAtTimestamp: endTimestamp,
      resolvedAtIndex: durationBars,
      maxFavorableExcursionPips: evidence.outcome.maximumFavorableExcursion ?? 0,
      maxAdverseExcursionPips: evidence.outcome.maximumAdverseExcursion ?? 0,
      evaluationDurationBars: durationBars,
      evaluationCompleted: true,
    },
  };
}

function reasonCodeFor(status: OutcomeResult['outcomeStatus']): OutcomeResult['reason']['reasonCode'] {
  switch (status) {
    case 'TP': return 'TAKE_PROFIT_LEVEL_REACHED';
    case 'SL': return 'STOP_LOSS_LEVEL_REACHED';
    case 'BE': return 'BREAK_EVEN_LEVEL_REACHED';
    case 'EXPIRED': return 'EXPIRED_WITHOUT_RESOLUTION';
    case 'UNKNOWN': return 'INSUFFICIENT_FUTURE_DATA';
  }
}

function completionReasonFor(status: OutcomeResult['outcomeStatus']): OutcomeResult['completionReason'] {
  switch (status) {
    case 'TP': return 'take_profit_hit';
    case 'SL': return 'stop_loss_hit';
    case 'BE': return 'break_even_reached';
    case 'EXPIRED': return 'expired_without_resolution';
    case 'UNKNOWN': return 'insufficient_future_data';
  }
}

function createCoverage(snapshotCount: number, labeledCount: number): DatasetCoverage {
  return { snapshotCount, labeledCount, missingOutcomeCount: Math.max(0, snapshotCount - labeledCount), coverageRate: snapshotCount === 0 ? 0 : labeledCount / snapshotCount };
}

function readJsonl<T>(filePath: string, file: 'signals' | 'outcomes'): { records: T[]; errors: HistoricalLearningReadError[] } {
  if (!fs.existsSync(filePath)) return { records: [], errors: [] };
  const records: T[] = [];
  const errors: HistoricalLearningReadError[] = [];
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim(); if (!trimmed) return;
    try { records.push(JSON.parse(trimmed) as T); }
    catch (error) { errors.push({ file, line: index + 1, message: error instanceof Error ? error.message : String(error) }); }
  });
  return { records, errors };
}
