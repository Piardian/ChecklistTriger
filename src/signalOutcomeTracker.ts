import * as fs from 'fs';
import * as path from 'path';
import type { NotificationCandidate } from '../server/pipeline';
import type { Candle } from './types';
import type { SignalOutcome } from './signalOutcome';
import { createSignalOutcome } from './signalOutcome';
import type { CompletedSignalOutcomeEvaluationEvidence } from './signalEvidence';
import { getPipSize as getAssetPipSize } from './assetMetrics';

export interface OutcomeEvaluationPlan {
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly targetPrice: number;
  readonly riskDistance: number;
  readonly entryWindowBars: number;
  readonly maxHoldBars: number;
  readonly sameCandleResolution: 'STOP_LOSS_FIRST';
}

export interface OutcomeTrackingResult {
  readonly status: 'WAITING_ENTRY' | 'OPEN' | 'COMPLETED';
  readonly outcome: SignalOutcome | null;
  readonly plan: OutcomeEvaluationPlan;
  readonly entryTriggeredAt: number | null;
  readonly entryPrice: number | null;
  readonly exitPrice: number | null;
  readonly rrAchieved: number | null;
  readonly maximumFavorableExcursion: number | null;
  readonly maximumAdverseExcursion: number | null;
  readonly evaluation: CompletedSignalOutcomeEvaluationEvidence | null;
}

export interface OutcomeTrackerOptions {
  readonly entryWindowBars?: number;
  readonly maxHoldBars?: number;
  readonly invalidationBufferPips?: number;
  readonly targetRMultiple?: number;
  readonly stateFile?: string;
}

interface PersistedTrackedSignal {
  readonly candidate: NotificationCandidate;
  readonly plan: OutcomeEvaluationPlan;
  readonly trackingStartTimestamp: number;
  readonly entryTriggeredAt: number | null;
  readonly entryPrice: number | null;
  readonly mfe: number;
  readonly mae: number;
}

const DEFAULT_ENTRY_WINDOW_BARS = 16;
const DEFAULT_MAX_HOLD_BARS = 32;
const DEFAULT_INVALIDATION_BUFFER_PIPS = 1;
const DEFAULT_TARGET_R_MULTIPLE = 2;

export function buildResearchOutcomePlan(
  candidate: NotificationCandidate,
  options: OutcomeTrackerOptions = {}
): OutcomeEvaluationPlan {
  const entryWindowBars = positiveInteger(options.entryWindowBars, DEFAULT_ENTRY_WINDOW_BARS);
  const maxHoldBars = Math.max(entryWindowBars, positiveInteger(options.maxHoldBars, DEFAULT_MAX_HOLD_BARS));
  const invalidationBufferPips = positiveNumber(options.invalidationBufferPips, DEFAULT_INVALIDATION_BUFFER_PIPS);
  const targetRMultiple = positiveNumber(options.targetRMultiple, DEFAULT_TARGET_R_MULTIPLE);
  const zone = resolveZone(candidate);
  const entryPrice = (zone.low + zone.high) / 2;
  const pipSize = getAssetPipSize(candidate.symbol);
  const invalidationBuffer = invalidationBufferPips * pipSize;

  if (candidate.tradeDirection === 'long') {
    const stopPrice = zone.low - invalidationBuffer;
    const riskDistance = entryPrice - stopPrice;
    return Object.freeze({
      entryPrice,
      stopPrice,
      targetPrice: entryPrice + riskDistance * targetRMultiple,
      riskDistance,
      entryWindowBars,
      maxHoldBars,
      sameCandleResolution: 'STOP_LOSS_FIRST',
    });
  }

  const stopPrice = zone.high + invalidationBuffer;
  const riskDistance = stopPrice - entryPrice;
  return Object.freeze({
    entryPrice,
    stopPrice,
    targetPrice: entryPrice - riskDistance * targetRMultiple,
    riskDistance,
    entryWindowBars,
    maxHoldBars,
    sameCandleResolution: 'STOP_LOSS_FIRST',
  });
}

export function evaluateOutcome(
  candidate: NotificationCandidate,
  candles: readonly Candle[],
  options: OutcomeTrackerOptions = {}
): OutcomeTrackingResult {
  const plan = buildResearchOutcomePlan(candidate, options);
  const startTimestamp = candidate.validationCloseTimestamp ?? candidate.marketDataTimestamp ?? candidate.poi.relatedEvent.breakTimestamp;
  const future = normalizeFutureCandles(candles, startTimestamp);

  let entryIndex = -1;
  for (let index = 0; index < Math.min(plan.entryWindowBars, future.length); index += 1) {
    const candle = future[index];
    if (candle.low <= plan.entryPrice && candle.high >= plan.entryPrice) {
      entryIndex = index;
      break;
    }
  }

  if (entryIndex < 0) {
    if (future.length >= plan.entryWindowBars) {
      const exitCandle = future[plan.entryWindowBars - 1];
      return completedResult(
        plan,
        startTimestamp,
        plan,
        createSignalOutcome({
          signalContext: requireSignalContext(candidate),
          outcomeType: 'EXPIRED',
          timestamp: exitCandle.timestamp,
          reason: {
            code: 'ENTRY_WINDOW_EXPIRED',
            message: `Entry was not triggered within ${plan.entryWindowBars} completed 15M candles.`,
          },
        }),
        null,
        null,
        null,
        null,
        null,
        null,
        plan.entryWindowBars
      );
    }
    return waitingResult(plan);
  }

  const entryCandle = future[entryIndex];
  let mfe = 0;
  let mae = 0;
  // The entry candle establishes the first touch of the entry price, but its
  // OHLC does not reveal what happened before versus after that touch. Exclude
  // it from TP/SL evaluation and excursion measurement to avoid look-ahead.
  const barsAfterEntry = future.slice(entryIndex + 1);

  for (let offset = 0; offset < Math.min(plan.maxHoldBars, barsAfterEntry.length); offset += 1) {
    const candle = barsAfterEntry[offset];
    const favorable = candidate.tradeDirection === 'long'
      ? Math.max(0, candle.high - plan.entryPrice)
      : Math.max(0, plan.entryPrice - candle.low);
    const adverse = candidate.tradeDirection === 'long'
      ? Math.max(0, plan.entryPrice - candle.low)
      : Math.max(0, candle.high - plan.entryPrice);
    mfe = Math.max(mfe, favorable);
    mae = Math.max(mae, adverse);

    const hitStop = candidate.tradeDirection === 'long'
      ? candle.low <= plan.stopPrice
      : candle.high >= plan.stopPrice;
    const hitTarget = candidate.tradeDirection === 'long'
      ? candle.high >= plan.targetPrice
      : candle.low <= plan.targetPrice;

    // OHLC cannot reveal which level was hit first inside a single post-entry candle.
    // Resolve this ambiguity deterministically and conservatively as STOP_LOSS_FIRST.
    if (hitStop) {
      return completedResult(
        plan,
        startTimestamp,
        plan,
        createSignalOutcome({
          signalContext: requireSignalContext(candidate),
          outcomeType: 'STOP_LOSS',
          timestamp: candle.timestamp,
          reason: {
            code: 'STOP_LOSS_REACHED',
            message: 'Stop level was reached by subsequent market data. Same-candle conflicts resolve to STOP_LOSS_FIRST.',
          },
        }),
        entryCandle.timestamp,
        plan.entryPrice,
        plan.stopPrice,
        -1,
        mfe,
        mae,
        entryIndex + 1 + offset + 1
      );
    }

    if (hitTarget) {
      return completedResult(
        plan,
        startTimestamp,
        plan,
        createSignalOutcome({
          signalContext: requireSignalContext(candidate),
          outcomeType: 'TAKE_PROFIT',
          timestamp: candle.timestamp,
          reason: {
            code: 'TAKE_PROFIT_REACHED',
            message: 'Target level was reached by subsequent market data.',
          },
        }),
        entryCandle.timestamp,
        plan.entryPrice,
        plan.targetPrice,
        Math.abs(plan.targetPrice - plan.entryPrice) / plan.riskDistance,
        mfe,
        mae,
        entryIndex + 1 + offset + 1
      );
    }
  }

  if (barsAfterEntry.length >= plan.maxHoldBars) {
    const exitCandle = barsAfterEntry[plan.maxHoldBars - 1];
    const directionalMove = candidate.tradeDirection === 'long'
      ? exitCandle.close - plan.entryPrice
      : plan.entryPrice - exitCandle.close;
    return completedResult(
      plan,
      startTimestamp,
      plan,
      createSignalOutcome({
        signalContext: requireSignalContext(candidate),
        outcomeType: 'EXPIRED',
        timestamp: exitCandle.timestamp,
        reason: {
          code: 'MAX_HOLD_EXPIRED',
          message: `Maximum holding window of ${plan.maxHoldBars} completed 15M candles elapsed without TP or SL.`,
        },
      }),
      entryCandle.timestamp,
      plan.entryPrice,
      exitCandle.close,
      directionalMove / plan.riskDistance,
      mfe,
      mae,
      entryIndex + 1 + plan.maxHoldBars
    );
  }

  return {
    status: 'OPEN',
    outcome: null,
    plan,
    entryTriggeredAt: entryCandle.timestamp,
    entryPrice: plan.entryPrice,
    exitPrice: null,
    rrAchieved: null,
    maximumFavorableExcursion: mfe,
    maximumAdverseExcursion: mae,
    evaluation: null,
  };
}

export class MarketDataOutcomeTracker {
  private readonly records = new Map<string, PersistedTrackedSignal>();
  private readonly stateFile: string;

  constructor(options: OutcomeTrackerOptions = {}) {
    this.stateFile = path.resolve(options.stateFile ?? process.env.OUTCOME_TRACKER_STATE_FILE ?? 'data/active_outcomes.json');
    this.load();
  }

  register(candidate: NotificationCandidate, options: OutcomeTrackerOptions = {}): void {
    const signalId = candidate.signalId ?? candidate.uniqueKey;
    if (this.records.has(signalId)) return;

    const plan = buildResearchOutcomePlan(candidate, options);
    const trackingStartTimestamp = candidate.validationCloseTimestamp ?? candidate.marketDataTimestamp ?? candidate.poi.relatedEvent.breakTimestamp;
    this.records.set(signalId, {
      candidate,
      plan,
      trackingStartTimestamp,
      entryTriggeredAt: null,
      entryPrice: null,
      mfe: 0,
      mae: 0,
    });
    this.persist();
  }

  process(symbol: string, candles: readonly Candle[], options: OutcomeTrackerOptions = {}): OutcomeTrackingResult[] {
    const results: OutcomeTrackingResult[] = [];
    for (const [signalId, record] of [...this.records.entries()]) {
      if (record.candidate.symbol !== symbol) continue;
      const result = evaluateOutcome(record.candidate, candles, {
        ...options,
        entryWindowBars: options.entryWindowBars ?? record.plan.entryWindowBars,
        maxHoldBars: options.maxHoldBars ?? record.plan.maxHoldBars,
      });
      results.push(result);
      if (result.status === 'COMPLETED') {
        this.records.delete(signalId);
      } else {
        this.records.set(signalId, {
          ...record,
          entryTriggeredAt: result.entryTriggeredAt,
          entryPrice: result.entryPrice,
          mfe: result.maximumFavorableExcursion ?? record.mfe,
          mae: result.maximumAdverseExcursion ?? record.mae,
        });
      }
    }
    this.persist();
    return results;
  }

  has(signalId: string): boolean {
    return this.records.has(signalId);
  }

  size(): number {
    return this.records.size;
  }

  private load(): void {
    if (!fs.existsSync(this.stateFile)) return;
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8');
      const records = JSON.parse(raw) as PersistedTrackedSignal[];
      if (!Array.isArray(records)) return;
      for (const record of records) {
        const signalId = record.candidate.signalId ?? record.candidate.uniqueKey;
        if (signalId) this.records.set(signalId, record);
      }
    } catch {
      // Corrupt tracker state must not crash the polling process. Start empty.
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const temp = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify([...this.records.values()], null, 2), 'utf8');
      fs.renameSync(temp, this.stateFile);
    } catch {
      // Outcome tracking is best-effort persistence; market evaluation remains in-memory.
    }
  }
}

export const defaultMarketDataOutcomeTracker = new MarketDataOutcomeTracker();

function normalizeFutureCandles(candles: readonly Candle[], startTimestamp: number): Candle[] {
  return [...candles]
    .filter(candle => Number.isFinite(candle.timestamp) && candle.timestamp > startTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function waitingResult(plan: OutcomeEvaluationPlan): OutcomeTrackingResult {
  return {
    status: 'WAITING_ENTRY',
    outcome: null,
    plan,
    entryTriggeredAt: null,
    entryPrice: null,
    exitPrice: null,
    rrAchieved: null,
    maximumFavorableExcursion: null,
    maximumAdverseExcursion: null,
    evaluation: null,
  };
}

function completedResult(
  plan: OutcomeEvaluationPlan,
  evaluationStartTimestamp: number,
  evaluationPlan: OutcomeEvaluationPlan,
  outcome: SignalOutcome,
  entryTriggeredAt: number | null,
  entryPrice: number | null,
  exitPrice: number | null,
  rrAchieved: number | null,
  mfe: number | null,
  mae: number | null,
  evaluatedCandles: number
): OutcomeTrackingResult {
  const evaluation: CompletedSignalOutcomeEvaluationEvidence = {
    version: 1,
    entryPrice: evaluationPlan.entryPrice,
    stopPrice: evaluationPlan.stopPrice,
    targetPrice: evaluationPlan.targetPrice,
    riskDistance: evaluationPlan.riskDistance,
    entryWindowBars: evaluationPlan.entryWindowBars,
    maxHoldBars: evaluationPlan.maxHoldBars,
    sameCandleResolution: evaluationPlan.sameCandleResolution,
    entryTriggeredAt,
    evaluatedCandles,
    evaluationStartTimestamp,
    evaluationEndTimestamp: outcome.timestamp,
  };

  return {
    status: 'COMPLETED',
    outcome,
    plan,
    entryTriggeredAt,
    entryPrice,
    exitPrice,
    rrAchieved,
    maximumFavorableExcursion: mfe,
    maximumAdverseExcursion: mae,
    evaluation,
  };
}

function requireSignalContext(candidate: NotificationCandidate) {
  if (!candidate.signalContext) {
    throw new Error(`Outcome tracking requires signalContext for ${candidate.signalId ?? candidate.uniqueKey}.`);
  }
  return candidate.signalContext;
}

function resolveZone(candidate: NotificationCandidate): { low: number; high: number } {
  if (candidate.poiType === 'OB') {
    const ob = candidate.poi as { low: number; high: number };
    return { low: ob.low, high: ob.high };
  }
  const fvg = candidate.poi as { gapLow: number; gapHigh: number };
  return { low: fvg.gapLow, high: fvg.gapHigh };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}
