import { CandleStore, StoredCandle, Timeframe } from '../server/candleStore';
import { NotifiedStore } from '../server/notifiedStore';
import { NotificationCandidate, runPipeline } from '../server/pipeline';
import { evaluateHardMarketWindow, evaluateKillzoneFilter } from '../server/killzone';
import { Symbol } from '../server/universe';
import {
  evaluateOutcome,
  OutcomeTrackerOptions,
  OutcomeTrackingResult,
} from './signalOutcomeTracker';
import { JsonlEvidenceStore } from '../server/evidenceStore';
import { buildSignalEvidenceRecord } from '../server/evidenceRecorder';
import { runRuntimeExecutionPipeline } from '../server/runtimeExecutionPipeline';
import { NoopSignalRepository } from './signalRepository';
import {
  createCompletedSignalOutcomeEvidence,
  createSignalPricePathEvidenceRecord,
} from './signalEvidence';

export const HISTORICAL_MARKET_REPLAY_VERSION = 1 as const;

export type HistoricalMarketReplayStatus = 'EMPTY' | 'COMPLETED';
export type HistoricalReplayOutcomeStatus =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'EXPIRED'
  | 'UNRESOLVED';

export interface HistoricalMarketReplayDataset {
  readonly symbol: Symbol;
  readonly candles15m: readonly StoredCandle[];
  readonly candles1h: readonly StoredCandle[];
  readonly candles4h: readonly StoredCandle[];
}

export interface HistoricalMarketReplayTrade {
  readonly signalId: string;
  readonly detectedTimestamp: number;
  readonly sourceSignalTimestamp: number;
  readonly symbol: Symbol;
  readonly direction: NotificationCandidate['tradeDirection'];
  readonly poiType: NotificationCandidate['poiType'];
  readonly grade: string | null;
  readonly score: number | null;
  readonly poiFormedTimestamp: number;
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly targetPrice: number;
  readonly riskDistance: number;
  readonly outcomeStatus: HistoricalReplayOutcomeStatus;
  readonly outcomeReasonCode: string | null;
  readonly entryTriggeredAt: number | null;
  readonly exitTimestamp: number | null;
  readonly rrAchieved: number | null;
  readonly maximumFavorableExcursion: number | null;
  readonly maximumAdverseExcursion: number | null;
  readonly sameCandleConflict: boolean;
  readonly evaluatedCandles: number;
  readonly evaluationStartTimestamp: number | null;
  readonly evaluationEndTimestamp: number | null;
}

export interface HistoricalMarketReplaySessionMetadata {
  readonly repositoryMutated: false;
  readonly runtimeAffected: false;
  readonly telemetryWritten: false;
  readonly notificationSent: false;
  readonly tradingLogicChanged: false;
  readonly outcomeChanged: false;
  readonly benchmarkChanged: false;
}

export interface HistoricalMarketReplaySession {
  readonly replayVersion: typeof HISTORICAL_MARKET_REPLAY_VERSION;
  readonly replaySessionId: string;
  readonly symbol: Symbol;
  readonly startedTimestamp: number;
  readonly finishedTimestamp: number;
  readonly replayStatus: HistoricalMarketReplayStatus;
  readonly replayStepCount: number;
  readonly skippedMarketWindowSteps: number;
  readonly skippedKillzoneSteps: number;
  readonly marketCandleCount15m: number;
  readonly candidateCount: number;
  readonly completedOutcomeCount: number;
  readonly unresolvedOutcomeCount: number;
  readonly trades: readonly HistoricalMarketReplayTrade[];
  readonly metadata: HistoricalMarketReplaySessionMetadata;
}

export interface HistoricalMarketReplayCandidateGeneratorInput {
  readonly symbol: Symbol;
  readonly candleStore: CandleStore;
  readonly notifiedStore: NotifiedStore;
  readonly replayTimestamp: number;
}

export type HistoricalMarketReplayCandidateGenerator = (
  input: HistoricalMarketReplayCandidateGeneratorInput
) => readonly NotificationCandidate[];

export interface HistoricalMarketReplayOptions {
  readonly startedTimestamp?: number;
  readonly finishedTimestamp?: number;
  readonly respectMarketWindow?: boolean;
  readonly respectKillzone?: boolean;
  readonly outcomeOptions?: OutcomeTrackerOptions;
  readonly seedSeenKeys?: readonly string[];
  readonly candidateGenerator?: HistoricalMarketReplayCandidateGenerator;
  readonly recordEvidence?: boolean;
  readonly evidenceDir?: string;
  readonly includePricePath?: boolean;
}

class HistoricalReplayCandleStore extends CandleStore {
  private cutoffTimestamp = Number.POSITIVE_INFINITY;

  constructor(private readonly dataset: HistoricalMarketReplayDataset) {
    super();
  }

  setCutoffTimestamp(timestamp: number): void {
    this.cutoffTimestamp = timestamp;
  }

  override getCandles(symbol: Symbol, timeframe: Timeframe): StoredCandle[] {
    if (symbol !== this.dataset.symbol) return [];

    const source =
      timeframe === '15m'
        ? this.dataset.candles15m
        : timeframe === '1h'
          ? this.dataset.candles1h
          : timeframe === '4h'
            ? this.dataset.candles4h
            : [];

    return source
      .filter(candle => candle.timestamp <= this.cutoffTimestamp)
      .map(candle => ({ ...candle }));
  }
}

class HistoricalReplayNotifiedStore extends NotifiedStore {
  private readonly seenKeys: Set<string>;

  constructor(seedSeenKeys: readonly string[] = []) {
    super();
    this.seenKeys = new Set(seedSeenKeys.filter(Boolean));
  }

  override hasBeenNotified(uniqueKey: string): boolean {
    return this.seenKeys.has(uniqueKey);
  }

  markSeen(keys: readonly string[]): void {
    for (const key of keys) {
      if (key) this.seenKeys.add(key);
    }
  }
}

export function runHistoricalMarketReplay(
  dataset: HistoricalMarketReplayDataset,
  options: HistoricalMarketReplayOptions = {}
): HistoricalMarketReplaySession {
  validateDataset(dataset);

  const normalizedDataset = normalizeDataset(dataset);
  const startedTimestamp =
    options.startedTimestamp ?? normalizedDataset.candles15m[0]?.timestamp ?? 0;
  const finishedTimestamp =
    options.finishedTimestamp ??
    normalizedDataset.candles15m[normalizedDataset.candles15m.length - 1]?.timestamp ??
    startedTimestamp;

  if (startedTimestamp > finishedTimestamp) {
    throw new RangeError(
      `Historical market replay start timestamp (${startedTimestamp}) cannot be after finish timestamp (${finishedTimestamp}).`
    );
  }

  const replayCandles = normalizedDataset.candles15m.filter(
    candle => candle.timestamp >= startedTimestamp && candle.timestamp <= finishedTimestamp
  );
  const boundedOutcomeCandles = normalizedDataset.candles15m.filter(
    candle => candle.timestamp <= finishedTimestamp
  );
  const respectMarketWindow = options.respectMarketWindow ?? true;
  const respectKillzone = options.respectKillzone ?? true;
  const candleStore = new HistoricalReplayCandleStore(normalizedDataset);
  const notifiedStore = new HistoricalReplayNotifiedStore(options.seedSeenKeys);
  const candidateGenerator = options.candidateGenerator ?? defaultCandidateGenerator;
  const trades: HistoricalMarketReplayTrade[] = [];

  let skippedMarketWindowSteps = 0;
  let skippedKillzoneSteps = 0;

  for (const candle of replayCandles) {
    candleStore.setCutoffTimestamp(candle.timestamp);

    if (respectMarketWindow) {
      const marketWindow = evaluateHardMarketWindow(new Date(candle.timestamp), normalizedDataset.symbol);
      if (!marketWindow.active) {
        skippedMarketWindowSteps += 1;
        continue;
      }
    }

    if (respectKillzone) {
      const killzone = evaluateKillzoneFilter(new Date(candle.timestamp));
      if (!killzone.active) {
        skippedKillzoneSteps += 1;
        continue;
      }
    }

    const candidates = withTelemetryDisabled(() =>
      candidateGenerator({
        symbol: normalizedDataset.symbol,
        candleStore,
        notifiedStore,
        replayTimestamp: candle.timestamp,
      })
    );

    for (const candidate of candidates) {
      assertCandidateIsCausal(candidate, candle.timestamp);

      const dedupeKeys = [candidate.uniqueKey, candidate.dedupeKey].filter(
        (key): key is string => Boolean(key)
      );
      if (dedupeKeys.some(key => notifiedStore.hasBeenNotified(key))) {
        continue;
      }
      notifiedStore.markSeen(dedupeKeys);

      const outcomeOptions: OutcomeTrackerOptions = {
        ...options.outcomeOptions,
        includePricePath: options.includePricePath ?? options.outcomeOptions?.includePricePath,
      };

      const outcome = evaluateOutcome(candidate, boundedOutcomeCandles, outcomeOptions);
      trades.push(createReplayTrade(candidate, candle.timestamp, outcome));

      if (options.recordEvidence) {
        const evidenceDir = options.evidenceDir ?? 'evidence/replay';
        recordReplayEvidence(candidate, candleStore.getCandles(candidate.symbol, '15m'), outcome, evidenceDir);
      }
    }
  }

  const completedOutcomeCount = trades.filter(
    trade => trade.outcomeStatus !== 'UNRESOLVED'
  ).length;
  const unresolvedOutcomeCount = trades.length - completedOutcomeCount;

  return Object.freeze({
    replayVersion: HISTORICAL_MARKET_REPLAY_VERSION,
    replaySessionId: createReplaySessionId({
      dataset: normalizedDataset,
      startedTimestamp,
      finishedTimestamp,
      respectMarketWindow,
      respectKillzone,
      outcomeOptions: options.outcomeOptions,
      seedSeenKeys: options.seedSeenKeys ?? [],
      trades,
    }),
    symbol: normalizedDataset.symbol,
    startedTimestamp,
    finishedTimestamp,
    replayStatus: replayCandles.length === 0 ? 'EMPTY' : 'COMPLETED',
    replayStepCount: replayCandles.length,
    skippedMarketWindowSteps,
    skippedKillzoneSteps,
    marketCandleCount15m: replayCandles.length,
    candidateCount: trades.length,
    completedOutcomeCount,
    unresolvedOutcomeCount,
    trades: Object.freeze(trades),
    metadata: Object.freeze({
      repositoryMutated: false as const,
      runtimeAffected: false as const,
      telemetryWritten: false as const,
      notificationSent: false as const,
      tradingLogicChanged: false as const,
      outcomeChanged: false as const,
      benchmarkChanged: false as const,
    }),
  });
}

function defaultCandidateGenerator(
  input: HistoricalMarketReplayCandidateGeneratorInput
): readonly NotificationCandidate[] {
  return Object.freeze(
    runPipeline(
      input.symbol,
      input.candleStore,
      input.notifiedStore,
      input.replayTimestamp
    )
  );
}

function createReplayTrade(
  candidate: NotificationCandidate,
  detectedTimestamp: number,
  outcome: OutcomeTrackingResult
): HistoricalMarketReplayTrade {
  if (!candidate.signalContext) {
    throw new Error(
      `Historical market replay candidate ${candidate.signalId ?? candidate.uniqueKey} has no signalContext.`
    );
  }

  const outcomeStatus: HistoricalReplayOutcomeStatus =
    outcome.outcome === null
      ? 'UNRESOLVED'
      : outcome.outcome.outcomeType === 'TAKE_PROFIT'
        ? 'TAKE_PROFIT'
        : outcome.outcome.outcomeType === 'STOP_LOSS'
          ? 'STOP_LOSS'
          : outcome.outcome.outcomeType === 'EXPIRED'
            ? 'EXPIRED'
            : 'UNRESOLVED';

  return Object.freeze({
    signalId: candidate.signalId ?? candidate.uniqueKey,
    detectedTimestamp,
    sourceSignalTimestamp: candidate.signalContext.timestamp,
    symbol: candidate.symbol,
    direction: candidate.tradeDirection,
    poiType: candidate.poiType,
    grade: candidate.gradeResult.grade,
    score: candidate.gradeResult.totalScore,
    poiFormedTimestamp: candidate.poiFormedTimestamp,
    entryPrice: outcome.plan.entryPrice,
    stopPrice: outcome.plan.stopPrice,
    targetPrice: outcome.plan.targetPrice,
    riskDistance: outcome.plan.riskDistance,
    outcomeStatus,
    outcomeReasonCode: outcome.outcome?.reason.code ?? null,
    entryTriggeredAt: outcome.entryTriggeredAt,
    exitTimestamp: outcome.outcome?.timestamp ?? null,
    rrAchieved: outcome.rrAchieved,
    maximumFavorableExcursion: outcome.maximumFavorableExcursion,
    maximumAdverseExcursion: outcome.maximumAdverseExcursion,
    sameCandleConflict: outcome.sameCandleConflict,
    evaluatedCandles: outcome.evaluation?.evaluatedCandles ?? 0,
    evaluationStartTimestamp: outcome.evaluation?.evaluationStartTimestamp ?? null,
    evaluationEndTimestamp: outcome.evaluation?.evaluationEndTimestamp ?? null,
  });
}

function assertCandidateIsCausal(
  candidate: NotificationCandidate,
  replayTimestamp: number
): void {
  const candidateObservationTimestamp =
    candidate.validationCloseTimestamp ??
    candidate.marketDataTimestamp ??
    candidate.signalContext?.timestamp ??
    candidate.poiFormedTimestamp;

  if (candidateObservationTimestamp > replayTimestamp) {
    throw new Error(
      `Historical market replay detected future candidate data for ${candidate.signalId ?? candidate.uniqueKey}: ` +
      `candidate observation ${candidateObservationTimestamp} > replay timestamp ${replayTimestamp}.`
    );
  }
}

function validateDataset(dataset: HistoricalMarketReplayDataset): void {
  if (!dataset.symbol) {
    throw new Error('Historical market replay requires a symbol.');
  }

  for (const [timeframe, candles] of Object.entries({
    '15m': dataset.candles15m,
    '1h': dataset.candles1h,
    '4h': dataset.candles4h,
  })) {
    for (const candle of candles) {
      if (
        !Number.isFinite(candle.timestamp) ||
        !Number.isFinite(candle.open) ||
        !Number.isFinite(candle.high) ||
        !Number.isFinite(candle.low) ||
        !Number.isFinite(candle.close)
      ) {
        throw new Error(`Historical market replay ${timeframe} dataset contains a non-finite candle.`);
      }
      if (candle.high < candle.low) {
        throw new Error(`Historical market replay ${timeframe} dataset contains high < low.`);
      }
    }
  }
}

function normalizeDataset(dataset: HistoricalMarketReplayDataset): HistoricalMarketReplayDataset {
  return Object.freeze({
    symbol: dataset.symbol,
    candles15m: normalizeCandles(dataset.candles15m),
    candles1h: normalizeCandles(dataset.candles1h),
    candles4h: normalizeCandles(dataset.candles4h),
  });
}

function normalizeCandles(candles: readonly StoredCandle[]): readonly StoredCandle[] {
  const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].timestamp === sorted[index - 1].timestamp) {
      throw new Error(
        `Historical market replay dataset contains duplicate candle timestamp ${sorted[index].timestamp}.`
      );
    }
  }
  return Object.freeze(sorted.map(candle => Object.freeze({ ...candle })));
}

function createReplaySessionId(input: {
  readonly dataset: HistoricalMarketReplayDataset;
  readonly startedTimestamp: number;
  readonly finishedTimestamp: number;
  readonly respectMarketWindow: boolean;
  readonly respectKillzone: boolean;
  readonly outcomeOptions?: OutcomeTrackerOptions;
  readonly seedSeenKeys: readonly string[];
  readonly trades: readonly HistoricalMarketReplayTrade[];
}): string {
  const source = stableStringify({
    symbol: input.dataset.symbol,
    candles15m: input.dataset.candles15m,
    candles1h: input.dataset.candles1h,
    candles4h: input.dataset.candles4h,
    startedTimestamp: input.startedTimestamp,
    finishedTimestamp: input.finishedTimestamp,
    respectMarketWindow: input.respectMarketWindow,
    respectKillzone: input.respectKillzone,
    outcomeOptions: input.outcomeOptions ?? {},
    seedSeenKeys: [...input.seedSeenKeys].sort(),
    trades: input.trades,
    replayVersion: HISTORICAL_MARKET_REPLAY_VERSION,
  });
  return `HISTORICAL_MARKET_REPLAY_${hashString(source)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(',')}}`;
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function withTelemetryDisabled<T>(fn: () => T): T {
  const previousValue = process.env.ENABLE_TELEMETRY;
  process.env.ENABLE_TELEMETRY = 'false';
  try {
    return fn();
  } finally {
    if (previousValue === undefined) {
      delete process.env.ENABLE_TELEMETRY;
    } else {
      process.env.ENABLE_TELEMETRY = previousValue;
    }
  }
}

function recordReplayEvidence(
  candidate: NotificationCandidate,
  candles15m: readonly StoredCandle[],
  outcome: OutcomeTrackingResult,
  evidenceDir: string
): void {
  const store = new JsonlEvidenceStore(evidenceDir);
  const execution = runRuntimeExecutionPipeline(candidate, new NoopSignalRepository());
  const signalRecord = buildSignalEvidenceRecord(candidate, execution, candles15m);
  store.appendSignalEvidenceSync(signalRecord);

  if (outcome.outcome && outcome.evaluation) {
    const outcomeType = outcome.outcome.outcomeType === 'TAKE_PROFIT'
      ? 'TP'
      : outcome.outcome.outcomeType === 'STOP_LOSS'
        ? 'SL'
        : outcome.outcome.outcomeType === 'EXPIRED'
          ? 'EXPIRED'
          : 'UNKNOWN';

    const outcomeRecord = createCompletedSignalOutcomeEvidence({
      signalId: signalRecord.metadata.signalId,
      outcome: {
        type: outcomeType,
        holdingTimeMs: outcome.calendarDurationMs,
        holdingBars: outcome.holdingBars,
        rrAchieved: outcome.rrAchieved,
        maximumFavorableExcursion: outcome.maximumFavorableExcursion,
        maximumAdverseExcursion: outcome.maximumAdverseExcursion,
        exitTimestamp: outcome.outcome.timestamp,
        exitPrice: outcome.exitPrice,
        exitReason: outcome.outcome.reason.message,
      },
      entry: {
        triggered: outcome.entryTriggeredAt !== null,
        timestamp: outcome.entryTriggeredAt,
        price: outcome.entryPrice,
        entryMode: outcome.plan.entryMode ?? 'midpoint',
      },
      risk: {
        stop: outcome.plan.stopPrice,
        target: outcome.plan.targetPrice,
        riskDistance: outcome.plan.riskDistance,
        targetR: outcome.plan.targetRMultiple ?? 2,
      },
      evaluation: outcome.evaluation,
    });
    store.appendOutcomeEvidenceSync(outcomeRecord);
  }

  if (outcome.pricePath && outcome.pricePath.length > 0) {
    const pricePathRecord = createSignalPricePathEvidenceRecord({
      signalId: signalRecord.metadata.signalId,
      symbol: candidate.symbol,
      recordedAt: new Date().toISOString(),
      points: outcome.pricePath,
    });
    store.appendPricePathEvidenceSync(pricePathRecord);
  }
}

