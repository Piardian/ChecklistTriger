import type { NotificationCandidate } from '../server/pipeline';
import type { Candle } from './types';
import type { SignalOutcome } from './signalOutcome';
import { createSignalOutcome } from './signalOutcome';
import type { SignalRepository } from './signalRepository';

export interface OutcomeEvaluationPlan {
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly targetPrice: number;
  readonly riskDistance: number;
  readonly entryWindowBars: number;
  readonly maxHoldBars: number;
  readonly sameCandleResolution: 'STOP_LOSS_FIRST';
}

export interface TrackedSignalState {
  readonly candidate: NotificationCandidate;
  readonly plan: OutcomeEvaluationPlan;
  readonly trackingStartTimestamp: number;
  readonly entryTriggeredAt?: number;
  readonly entryPrice?: number;
  readonly mfe?: number;
  readonly mae?: number;
}

export interface OutcomeTrackerOptions {
  readonly entryWindowBars?: number;
  readonly maxHoldBars?: number;
  readonly invalidationBufferPips?: number;
  readonly targetRMultiple?: number;
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
  const pipSize = getPipSize(candidate.symbol);
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
  const future = candles
    .filter(candle => candle.timestamp > startTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

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
      return completedResult(candidate, plan, createSignalOutcome({
        signalContext: requireSignalContext(candidate),
        outcomeType: 'EXPIRED',
        timestamp: future[plan.entryWindowBars - 1].timestamp,
        reason: {
          code: 'ENTRY_WINDOW_EXPIRED',
          message: `Entry was not triggered within ${plan.entryWindowBars} completed 15M candles.`,
        },
      }), null, null, null, null, null);
    }

    return waitingResult(plan);
  }

  const entryCandle = future[entryIndex];
  let mfe = 0;
  let mae = 0;
  const barsAfterEntry = future.slice(entryIndex);

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

    if (hitStop) {
      const rr = -1;
      return completedResult(
        candidate,
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
        candle.timestamp,
        plan.entryPrice,
        plan.stopPrice,
        rr,
        mfe,
        mae
      );
    }

    if (hitTarget) {
      const rr = plan.targetPriceDistance / plan.riskDistance;
      return completedResult(
        candidate,
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
        candle.timestamp,
        plan.entryPrice,
        plan.targetPrice,
        rr,
        mfe,
        mae
      );
    }
  }

  if (barsAfterEntry.length >= plan.maxHoldBars) {
    const exitCandle = barsAfterEntry[plan.maxHoldBars - 1];
    const directionalMove = candidate.tradeDirection === 'long'
      ? exitCandle.close - plan.entryPrice
      : plan.entryPrice - exitCandle.close;
    const rr = directionalMove / plan.riskDistance;
    return completedResult(
      candidate,
      plan,
      createSignalOutcome({
        signalContext: requireSignalContext(candidate),
        outcomeType: 'EXPIRED',
        timestamp: exitCandle.timestamp,
        reason: {
          code: 'ENTRY_WINDOW_EXPIRED',
          message: `Maximum holding window of ${plan.maxHoldBars} completed 15M candles elapsed without TP or SL.`,
        },
      }),
      entryCandle.timestamp,
      plan.entryPrice,
      exitCandle.close,
      rr,
      mfe,
      mae
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
  };
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
  };
}

function completedResult(
  candidate: NotificationCandidate,
  plan: OutcomeEvaluationPlan,
  outcome: SignalOutcome,
  entryTriggeredAt: number | null,
  entryPrice: number | null,
  exitPrice: number | null,
  rrAchieved: number | null,
  mfe: number | null,
  mae: number | null
): OutcomeTrackingResult {
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

function getPipSize(symbol: string): number {
  const upper = symbol.toUpperCase();
  if (upper.includes('JPY')) return 0.01;
  if (upper.startsWith('XAU')) return 0.1;
  if (upper === 'NAS100' || upper === 'US100' || upper === 'US30' || upper === 'SPX500' || upper === 'GER40') return 1;
  return 0.0001;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}
