import { ALL_SYMBOLS } from '../server/universe';
import {
  CompletedSignalOutcomeEvidence,
  SignalEvidenceRecord,
  SignalPricePathEvidenceRecord,
} from './signalEvidence';

const SUPPORTED_SYMBOLS: readonly string[] = [...ALL_SYMBOLS, 'BTCEUR', 'ETHEUR', 'LTCEUR'];
const VALID_OUTCOME_TYPES = new Set(['TP', 'SL', 'BE', 'MANUAL', 'EXPIRED', 'CANCELLED', 'UNKNOWN']);

export interface ResearchValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly signalId?: string;
  readonly field?: string;
  readonly message: string;
}

export interface ResearchValidationReport {
  readonly isValid: boolean;
  readonly totalSignals: number;
  readonly totalOutcomes: number;
  readonly totalPricePaths: number;
  readonly issues: readonly ResearchValidationIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export interface ResearchValidationInput {
  readonly signals: readonly SignalEvidenceRecord[];
  readonly outcomes?: readonly CompletedSignalOutcomeEvidence[];
  readonly pricePaths?: readonly SignalPricePathEvidenceRecord[];
}

export function validateResearchEvidence(input: ResearchValidationInput): ResearchValidationReport {
  const issues: ResearchValidationIssue[] = [];
  const signalsById = new Map<string, SignalEvidenceRecord>();

  // 1. Validate Signals
  for (const signal of input.signals) {
    validateSignalRecord(signal, issues, signalsById);
  }

  // 2. Validate Outcomes (if present)
  if (input.outcomes) {
    for (const outcome of input.outcomes) {
      validateOutcomeRecord(outcome, issues, signalsById);
    }
  }

  // 3. Validate Price Paths (if present)
  if (input.pricePaths) {
    for (const pricePath of input.pricePaths) {
      validatePricePathRecord(pricePath, issues, signalsById);
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  return Object.freeze({
    isValid: errorCount === 0,
    totalSignals: input.signals.length,
    totalOutcomes: input.outcomes?.length ?? 0,
    totalPricePaths: input.pricePaths?.length ?? 0,
    issues: Object.freeze(issues),
    errorCount,
    warningCount,
  });
}

export function assertValidResearchEvidence(input: ResearchValidationInput): void {
  const report = validateResearchEvidence(input);
  if (!report.isValid) {
    const errorDetails = report.issues
      .filter(i => i.severity === 'error')
      .map(i => `[${i.code}] signalId=${i.signalId ?? 'unknown'}${i.field ? ` field=${i.field}` : ''}: ${i.message}`)
      .join('\n');
    throw new Error(`Research evidence validation failed with ${report.errorCount} errors:\n${errorDetails}`);
  }
}

function validateSignalRecord(
  signal: SignalEvidenceRecord,
  issues: ResearchValidationIssue[],
  signalsById: Map<string, SignalEvidenceRecord>
): void {
  const signalId = signal?.metadata?.signalId;

  if (!signalId || typeof signalId !== 'string' || signalId.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'MISSING_SIGNAL_ID',
      message: 'Signal record is missing a non-empty signalId.',
    });
    return;
  }

  if (signalsById.has(signalId)) {
    issues.push({
      severity: 'error',
      code: 'DUPLICATE_SIGNAL_ID',
      signalId,
      message: `Duplicate signalId ${signalId} detected in signals dataset.`,
    });
  } else {
    signalsById.set(signalId, signal);
  }

  const timestamp = signal.metadata?.timestamp;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_TIMESTAMP',
      signalId,
      field: 'metadata.timestamp',
      message: `Invalid signal timestamp: ${timestamp}`,
    });
  }

  const symbol = signal.metadata?.symbol;
  if (!symbol || !SUPPORTED_SYMBOLS.includes(symbol)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_SYMBOL',
      signalId,
      field: 'metadata.symbol',
      message: `Unsupported or missing symbol: ${symbol}`,
    });
  }

  const direction = signal.metadata?.direction;
  if (direction !== 'long' && direction !== 'short') {
    issues.push({
      severity: 'error',
      code: 'INVALID_DIRECTION',
      signalId,
      field: 'metadata.direction',
      message: `Direction must be 'long' or 'short', received: ${direction}`,
    });
  }

  // Check POI zone bounds
  const zoneHigh = signal.poi?.zoneHigh;
  const zoneLow = signal.poi?.zoneLow;
  if (!Number.isFinite(zoneHigh) || !Number.isFinite(zoneLow)) {
    issues.push({
      severity: 'error',
      code: 'NON_FINITE_NUMERIC_FIELD',
      signalId,
      field: 'poi.zone',
      message: `POI zone bounds must be finite numbers: high=${zoneHigh}, low=${zoneLow}`,
    });
  } else if (zoneHigh < zoneLow) {
    issues.push({
      severity: 'error',
      code: 'INVERTED_ZONE_BOUNDS',
      signalId,
      field: 'poi.zone',
      message: `POI zoneHigh (${zoneHigh}) is lower than zoneLow (${zoneLow}).`,
    });
  }

  // Check NaN / Infinity in critical numeric fields
  assertFinite(signal.poi?.poiAgeMs, 'poi.poiAgeMs', signalId, issues);
  assertFinite(signal.poi?.poiTestCount, 'poi.poiTestCount', signalId, issues);
  assertFinite(signal.structure?.eventTimestamp, 'structure.eventTimestamp', signalId, issues);
  assertFinite(signal.structure?.structureScore, 'structure.structureScore', signalId, issues);
  assertFinite(signal.grade?.totalScore, 'grade.totalScore', signalId, issues);

  if (signal.displacement?.displacementScore !== undefined) {
    assertFinite(signal.displacement.displacementScore, 'displacement.displacementScore', signalId, issues);
  }
}

function validateOutcomeRecord(
  outcome: CompletedSignalOutcomeEvidence,
  issues: ResearchValidationIssue[],
  signalsById: Map<string, SignalEvidenceRecord>
): void {
  const signalId = outcome?.signalId;

  if (!signalId || typeof signalId !== 'string' || signalId.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'MISSING_SIGNAL_ID',
      message: 'Outcome record is missing a valid signalId.',
    });
    return;
  }

  const signal = signalsById.get(signalId);
  if (!signal) {
    issues.push({
      severity: 'error',
      code: 'UNKNOWN_SIGNAL_REFERENCE',
      signalId,
      message: `Outcome references unknown signalId ${signalId}.`,
    });
  }

  const outcomeType = outcome.outcome?.type;
  if (!outcomeType || !VALID_OUTCOME_TYPES.has(outcomeType)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_OUTCOME_TYPE',
      signalId,
      field: 'outcome.type',
      message: `Unsupported outcome type: ${outcomeType}`,
    });
  }

  const exitTimestamp = outcome.outcome?.exitTimestamp;
  if (!Number.isFinite(exitTimestamp) || exitTimestamp <= 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_EXIT_TIMESTAMP',
      signalId,
      field: 'outcome.exitTimestamp',
      message: `Outcome exitTimestamp must be a positive finite number: ${exitTimestamp}`,
    });
  }

  if (signal && Number.isFinite(exitTimestamp) && Number.isFinite(signal.metadata.timestamp)) {
    if (exitTimestamp < signal.metadata.timestamp) {
      issues.push({
        severity: 'error',
        code: 'CAUSAL_VIOLATION_EXIT_PRECEDES_SIGNAL',
        signalId,
        message: `Outcome exitTimestamp (${exitTimestamp}) precedes signal observation (${signal.metadata.timestamp}).`,
      });
    }
  }

  // Check entry timestamp causality
  const entryTimestamp = outcome.entry?.timestamp ?? outcome.evaluation?.entryTriggeredAt;
  if (entryTimestamp !== null && entryTimestamp !== undefined) {
    if (!Number.isFinite(entryTimestamp)) {
      issues.push({
        severity: 'error',
        code: 'NON_FINITE_NUMERIC_FIELD',
        signalId,
        field: 'entry.timestamp',
        message: `Entry timestamp must be finite: ${entryTimestamp}`,
      });
    } else if (signal && entryTimestamp < signal.metadata.timestamp) {
      issues.push({
        severity: 'error',
        code: 'CAUSAL_VIOLATION_ENTRY_PRECEDES_SIGNAL',
        signalId,
        message: `Entry timestamp (${entryTimestamp}) precedes signal observation (${signal.metadata.timestamp}).`,
      });
    }
  }

  // Check evaluation causality
  const evalStart = outcome.evaluation?.evaluationStartTimestamp;
  const evalEnd = outcome.evaluation?.evaluationEndTimestamp;
  if (evalStart !== undefined && evalEnd !== null && evalEnd !== undefined) {
    if (evalEnd < evalStart) {
      issues.push({
        severity: 'error',
        code: 'CAUSAL_VIOLATION_EVALUATION_ORDERING',
        signalId,
        message: `Evaluation end timestamp (${evalEnd}) is earlier than start timestamp (${evalStart}).`,
      });
    }
  }
}

function validatePricePathRecord(
  pricePath: SignalPricePathEvidenceRecord,
  issues: ResearchValidationIssue[],
  signalsById: Map<string, SignalEvidenceRecord>
): void {
  const signalId = pricePath?.signalId;

  if (!signalId) {
    issues.push({
      severity: 'error',
      code: 'MISSING_SIGNAL_ID',
      message: 'Price path record is missing signalId.',
    });
    return;
  }

  const signal = signalsById.get(signalId);
  let lastTimestamp = 0;

  for (let idx = 0; idx < (pricePath.points?.length ?? 0); idx += 1) {
    const pt = pricePath.points[idx];
    if (!Number.isFinite(pt.timestamp) || !Number.isFinite(pt.open) || !Number.isFinite(pt.high) || !Number.isFinite(pt.low) || !Number.isFinite(pt.close)) {
      issues.push({
        severity: 'error',
        code: 'NON_FINITE_PRICE_PATH_POINT',
        signalId,
        field: `points[${idx}]`,
        message: `Price path point at index ${idx} contains non-finite OHLC or timestamp.`,
      });
      break;
    }

    if (signal && pt.timestamp < signal.metadata.timestamp) {
      issues.push({
        severity: 'error',
        code: 'CAUSAL_VIOLATION_PATH_PRECEDES_SIGNAL',
        signalId,
        field: `points[${idx}].timestamp`,
        message: `Price path timestamp (${pt.timestamp}) precedes signal observation (${signal.metadata.timestamp}).`,
      });
      break;
    }

    if (pt.timestamp < lastTimestamp) {
      issues.push({
        severity: 'error',
        code: 'NON_MONOTONIC_PRICE_PATH_TIMESTAMPS',
        signalId,
        field: `points[${idx}].timestamp`,
        message: `Price path timestamps must be strictly monotonic non-decreasing: ${pt.timestamp} < ${lastTimestamp}`,
      });
      break;
    }
    lastTimestamp = pt.timestamp;
  }
}

function assertFinite(value: unknown, field: string, signalId: string, issues: ResearchValidationIssue[]): void {
  if (value !== undefined && value !== null && !Number.isFinite(value)) {
    issues.push({
      severity: 'error',
      code: 'NON_FINITE_NUMERIC_FIELD',
      signalId,
      field,
      message: `Field ${field} must be a finite number: received ${String(value)}`,
    });
  }
}
