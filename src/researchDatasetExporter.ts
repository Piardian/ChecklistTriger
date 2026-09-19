import * as fs from 'fs';
import * as path from 'path';
import {
  CompletedSignalOutcomeEvidence,
  SignalEvidenceRecord,
  SignalPricePathEvidenceRecord,
  SIGNAL_EVIDENCE_SCHEMA_VERSION,
  SIGNAL_EVIDENCE_STRATEGY_VERSION,
  SIGNAL_OUTCOME_ENGINE_VERSION,
} from './signalEvidence';
import { assertValidResearchEvidence } from './signalResearchValidation';

export interface ResearchSignalOutcomeDatasetRow {
  // Identity & Versions
  readonly signalId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly timeframe: string;
  readonly signalTimestamp: number;
  readonly signalTimeUtc: string;
  readonly strategyVersion: string;
  readonly detectorVersion: number;
  readonly gradeVersion: number;
  readonly evidenceSchemaVersion: number;
  readonly outcomeEngineVersion: number;

  // Signal Classification & Setup
  readonly strategy: string;
  readonly setupType: string;
  readonly poiType: 'OB' | 'FVG';
  readonly structureEvent: 'BOS' | 'CHoCH';
  readonly grade: string;
  readonly score: number;
  readonly scoreBucket: '<6' | '6-7' | '8-9' | '10+';
  readonly entryAllowed: boolean;

  // HTF Context
  readonly bias4H: string;
  readonly bias1H: string;
  readonly bias15M: string | null;
  readonly htfAlignmentState: string;
  readonly pd4H: string;
  readonly pd1H: string;
  readonly pd15M: string | null;

  // POI Features
  readonly zoneHigh: number;
  readonly zoneLow: number;
  readonly midpoint: number;
  readonly poiAgeMs: number;
  readonly poiAgeBars: number;
  readonly poiAgeBucket: '<1h' | '1h-4h' | '4h-12h' | '12h+';
  readonly poiTestCount: number;
  readonly distanceFromCurrentPrice: number | null;
  readonly mitigationState: string;

  // Displacement & Sweep
  readonly displacementScore: number;
  readonly displacementBucket: '<50' | '50-69' | '70-84' | '85+';
  readonly bodyPercentage: number | null;
  readonly displacementRange: number | null;
  readonly impulseDirection: string;
  readonly atrNormalizedDisplacement: number | null;
  readonly sweepDetected: boolean;
  readonly sweepDirection: string;
  readonly sweepQuality: string;

  // Market & Session Context
  readonly session: string;
  readonly killzoneActive: boolean;
  readonly killzoneReason: string;
  readonly dayOfWeek: number;
  readonly dayOfWeekName: string;
  readonly hourUtc: number;
  readonly volatilityAtr: number | null;
  readonly volatilityBucket: string;
  readonly marketWindowState: string;
  readonly marketRegime: string | null;

  // Risk & Execution Plan
  readonly theoreticalRiskDistance: number | null;
  readonly entryMode: string;
  readonly plannedEntryPrice: number | null;
  readonly stopPrice: number | null;
  readonly targetPrice: number | null;
  readonly riskDistance: number | null;
  readonly targetRMultiple: number | null;

  // Outcome & Execution Results
  readonly outcomeType: string;
  readonly outcomeIsResolved: boolean;
  readonly outcomeIsWin: boolean;
  readonly outcomeIsLoss: boolean;
  readonly entryTriggered: boolean;
  readonly entryTimestamp: number | null;
  readonly entryTimeUtc: string | null;
  readonly entryPrice: number | null;
  readonly exitTimestamp: number | null;
  readonly exitTimeUtc: string | null;
  readonly exitPrice: number | null;
  readonly exitReason: string | null;
  readonly realizedR: number | null;
  readonly holdingBars: number | null;
  readonly calendarDurationMs: number | null;
  readonly mfe: number | null;
  readonly mae: number | null;
  readonly evaluatedCandles: number;
  readonly sameCandleResolution: string;
  readonly sameCandleConflict: boolean;

  // Price Path
  readonly pricePathEvaluatedCount: number | null;
}

export interface ResearchDatasetExportInput {
  readonly signals: readonly SignalEvidenceRecord[];
  readonly outcomes?: readonly CompletedSignalOutcomeEvidence[];
  readonly pricePaths?: readonly SignalPricePathEvidenceRecord[];
  readonly validate?: boolean;
}

export function exportResearchDataset(input: ResearchDatasetExportInput): readonly ResearchSignalOutcomeDatasetRow[] {
  if (input.validate !== false) {
    assertValidResearchEvidence({
      signals: input.signals,
      outcomes: input.outcomes,
      pricePaths: input.pricePaths,
    });
  }

  const outcomesById = new Map<string, CompletedSignalOutcomeEvidence>();
  for (const outcome of input.outcomes ?? []) {
    outcomesById.set(outcome.signalId, outcome);
  }

  const pricePathsById = new Map<string, SignalPricePathEvidenceRecord>();
  for (const pricePath of input.pricePaths ?? []) {
    pricePathsById.set(pricePath.signalId, pricePath);
  }

  const rows: ResearchSignalOutcomeDatasetRow[] = [];

  for (const signal of input.signals) {
    const outcome = outcomesById.get(signal.metadata.signalId);
    const pricePath = pricePathsById.get(signal.metadata.signalId);

    const midpoint = signal.poi.midpoint ?? (signal.poi.zoneHigh + signal.poi.zoneLow) / 2;
    const poiAgeMs = signal.poi.poiAgeMs;
    const poiAgeBars = signal.poi.poiAgeBars ?? Math.floor(poiAgeMs / (15 * 60 * 1000));
    const score = signal.grade.totalScore;
    const dispScore = signal.displacement.displacementScore;

    const outcomeType = outcome?.outcome?.type ?? 'UNRESOLVED';
    const isWin = outcomeType === 'TP';
    const isLoss = outcomeType === 'SL';
    const isResolved = isWin || isLoss || outcomeType === 'EXPIRED';

    const entryTriggered = outcome?.entry?.triggered ?? (outcome?.evaluation?.entryTriggeredAt !== null && outcome?.evaluation?.entryTriggeredAt !== undefined);
    const entryTimestamp = outcome?.entry?.timestamp ?? outcome?.evaluation?.entryTriggeredAt ?? null;
    const exitTimestamp = outcome?.outcome?.exitTimestamp ?? null;

    rows.push(Object.freeze({
      signalId: signal.metadata.signalId,
      symbol: signal.metadata.symbol,
      direction: signal.metadata.direction,
      timeframe: signal.metadata.timeframe,
      signalTimestamp: signal.metadata.timestamp,
      signalTimeUtc: new Date(signal.metadata.timestamp).toISOString(),
      strategyVersion: signal.metadata.strategyVersion ?? SIGNAL_EVIDENCE_STRATEGY_VERSION,
      detectorVersion: signal.metadata.detectorVersion,
      gradeVersion: signal.metadata.gradeVersion,
      evidenceSchemaVersion: signal.evidenceSchemaVersion ?? SIGNAL_EVIDENCE_SCHEMA_VERSION,
      outcomeEngineVersion: outcome?.outcomeEngineVersion ?? SIGNAL_OUTCOME_ENGINE_VERSION,

      strategy: signal.classification?.strategy ?? 'SWING_BOS_CORE',
      setupType: signal.classification?.setupType ?? (signal.structure.eventType === 'BOS' ? 'CONTINUATION' : 'REVERSAL'),
      poiType: signal.poi.poiType,
      structureEvent: signal.structure.eventType,
      grade: signal.grade.grade,
      score,
      scoreBucket: score < 6 ? '<6' : score <= 7 ? '6-7' : score <= 9 ? '8-9' : '10+',
      entryAllowed: signal.grade.entryAllowed,

      bias4H: signal.htfContext.bias4H,
      bias1H: signal.htfContext.bias1H,
      bias15M: signal.htfContext.bias15M ?? null,
      htfAlignmentState: signal.htfContext.htfAlignmentState ?? 'UNKNOWN',
      pd4H: signal.htfContext.pd4H,
      pd1H: signal.htfContext.pd1H,
      pd15M: signal.htfContext.pd15M ?? null,

      zoneHigh: signal.poi.zoneHigh,
      zoneLow: signal.poi.zoneLow,
      midpoint,
      poiAgeMs,
      poiAgeBars,
      poiAgeBucket: poiAgeMs < 3600000 ? '<1h' : poiAgeMs < 14400000 ? '1h-4h' : poiAgeMs < 43200000 ? '4h-12h' : '12h+',
      poiTestCount: signal.poi.poiTestCount,
      distanceFromCurrentPrice: signal.poi.distanceFromCurrentPrice ?? null,
      mitigationState: signal.poi.mitigationState ?? (signal.poi.poiTestCount > 0 ? 'PARTIALLY_MITIGATED' : 'UNMITIGATED'),

      displacementScore: dispScore,
      displacementBucket: dispScore < 50 ? '<50' : dispScore < 70 ? '50-69' : dispScore < 85 ? '70-84' : '85+',
      bodyPercentage: signal.displacement.bodyPercentage ?? null,
      displacementRange: signal.displacement.range ?? null,
      impulseDirection: signal.displacement.impulseDirection,
      atrNormalizedDisplacement: signal.displacement.atrNormalizedDisplacement ?? null,
      sweepDetected: signal.sweep.sweepDetected,
      sweepDirection: signal.sweep.sweepDirection,
      sweepQuality: signal.sweep.sweepQuality,

      session: signal.marketContext?.session ?? 'UNKNOWN',
      killzoneActive: signal.marketContext?.killzone?.active ?? false,
      killzoneReason: signal.marketContext?.killzone?.reason ?? 'UNKNOWN',
      dayOfWeek: signal.marketContext?.dayOfWeek ?? new Date(signal.metadata.timestamp).getUTCDay(),
      dayOfWeekName: signal.marketContext?.dayOfWeekName ?? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(signal.metadata.timestamp).getUTCDay()],
      hourUtc: signal.marketContext?.hourUtc ?? new Date(signal.metadata.timestamp).getUTCHours(),
      volatilityAtr: signal.marketContext?.volatilityAtr ?? null,
      volatilityBucket: 'UNKNOWN',
      marketWindowState: signal.marketContext?.marketWindowState?.active ? 'OPEN' : (signal.marketContext?.marketWindowState?.reason ?? 'UNKNOWN'),
      marketRegime: signal.marketContext?.marketRegime ?? null,

      theoreticalRiskDistance: signal.runtime?.riskResult?.theoreticalRiskDistance ?? Math.abs(signal.poi.zoneHigh - signal.poi.zoneLow),
      entryMode: outcome?.entry?.entryMode ?? outcome?.evaluation?.entryMode ?? 'midpoint',
      plannedEntryPrice: outcome?.evaluation?.entryPrice ?? midpoint,
      stopPrice: outcome?.risk?.stop ?? outcome?.evaluation?.stopPrice ?? null,
      targetPrice: outcome?.risk?.target ?? outcome?.evaluation?.targetPrice ?? null,
      riskDistance: outcome?.risk?.riskDistance ?? outcome?.evaluation?.riskDistance ?? null,
      targetRMultiple: outcome?.risk?.targetR ?? outcome?.evaluation?.targetRMultiple ?? null,

      outcomeType,
      outcomeIsResolved: isResolved,
      outcomeIsWin: isWin,
      outcomeIsLoss: isLoss,
      entryTriggered: entryTriggered ?? false,
      entryTimestamp,
      entryTimeUtc: entryTimestamp !== null ? new Date(entryTimestamp).toISOString() : null,
      entryPrice: outcome?.entry?.price ?? outcome?.evaluation?.entryPrice ?? null,
      exitTimestamp,
      exitTimeUtc: exitTimestamp !== null ? new Date(exitTimestamp).toISOString() : null,
      exitPrice: outcome?.outcome?.exitPrice ?? null,
      exitReason: outcome?.outcome?.exitReason ?? null,
      realizedR: outcome?.outcome?.rrAchieved ?? null,
      holdingBars: outcome?.outcome?.holdingBars ?? outcome?.evaluation?.holdingBars ?? null,
      calendarDurationMs: outcome?.outcome?.holdingTimeMs ?? outcome?.evaluation?.calendarDurationMs ?? null,
      mfe: outcome?.outcome?.maximumFavorableExcursion ?? null,
      mae: outcome?.outcome?.maximumAdverseExcursion ?? null,
      evaluatedCandles: outcome?.evaluation?.evaluatedCandles ?? 0,
      sameCandleResolution: outcome?.evaluation?.sameCandleResolution ?? 'STOP_LOSS_FIRST',
      sameCandleConflict: outcome?.evaluation?.sameCandleConflict ?? false,

      pricePathEvaluatedCount: pricePath ? pricePath.points.length : null,
    }));
  }

  // Deterministic sorting by signal timestamp ascending
  return Object.freeze(rows.sort((a, b) => a.signalTimestamp - b.signalTimestamp));
}

export function exportResearchDatasetToCsv(rows: readonly ResearchSignalOutcomeDatasetRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines: string[] = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map(header => {
      const val = (row as unknown as Record<string, unknown>)[header];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') {
        return val.includes(',') ? `"${val.replace(/"/g, '""')}"` : val;
      }
      return String(val);
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export function readAndExportResearchDataset(options: {
  readonly signalsFile: string;
  readonly outcomesFile: string;
  readonly pricePathsFile?: string;
  readonly outputFile?: string;
  readonly format?: 'json' | 'csv';
}): { readonly rows: readonly ResearchSignalOutcomeDatasetRow[]; readonly writtenFile?: string } {
  const signals = readJsonl<SignalEvidenceRecord>(options.signalsFile);
  const outcomes = fs.existsSync(options.outcomesFile) ? readJsonl<CompletedSignalOutcomeEvidence>(options.outcomesFile) : [];
  const pricePaths = options.pricePathsFile && fs.existsSync(options.pricePathsFile)
    ? readJsonl<SignalPricePathEvidenceRecord>(options.pricePathsFile)
    : [];

  const rows = exportResearchDataset({
    signals,
    outcomes,
    pricePaths,
    validate: true,
  });

  let writtenFile: string | undefined;
  if (options.outputFile) {
    fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
    if (options.format === 'csv') {
      const csv = exportResearchDatasetToCsv(rows);
      fs.writeFileSync(options.outputFile, csv, 'utf8');
    } else {
      fs.writeFileSync(options.outputFile, JSON.stringify(rows, null, 2), 'utf8');
    }
    writtenFile = path.resolve(options.outputFile);
  }

  return Object.freeze({ rows, writtenFile });
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as T);
}
