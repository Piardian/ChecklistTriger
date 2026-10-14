import type { Candle } from './types';
import { detectAssetClass, getPipSize } from './assetMetrics';

export interface CeEntryPlan {
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly targetPrice: number;
  readonly tp1Price: number;
  readonly tp2Price: number;
  readonly tp3Price: number;
  readonly riskDistance: number;
  readonly buffer: number;
  readonly zoneLow: number;
  readonly zoneHigh: number;
  readonly entryModel: 'midpoint' | 'edge' | 'zone_touch';
  readonly isLimit: boolean;
}

export interface CeEntryCalculationOptions {
  readonly direction: 'long' | 'short';
  readonly zoneLow: number;
  readonly zoneHigh: number;
  readonly symbol: string;
  readonly entryModel?: 'midpoint' | 'edge' | 'zone_touch';
  readonly targetRMultiple?: number;
  readonly dynamicBuffer?: boolean;
  readonly invalidationBufferPips?: number;
}

/**
 * Calculates asset-calibrated dynamic stop buffer based on asset class and POI zone width.
 */
export function calculateDynamicStopBuffer(symbol: string, zoneLow: number, zoneHigh: number): number {
  const assetClass = detectAssetClass(symbol);
  const upper = symbol.toUpperCase();
  const zoneWidth = Math.abs(zoneHigh - zoneLow);
  const pip = getPipSize(symbol);

  switch (assetClass) {
    case 'FOREX':
      // 2.0 pips base, scales up to 10% of zone width, capped at 3.5 pips
      return Math.min(3.5 * pip, Math.max(2.0 * pip, zoneWidth * 0.10));
    case 'FOREX_JPY':
      return Math.min(4.0 * pip, Math.max(2.5 * pip, zoneWidth * 0.10));
    case 'COMMODITY':
      if (upper.startsWith('XAU')) {
        return Math.max(1.50, zoneWidth * 0.10);
      }
      return Math.max(0.15, zoneWidth * 0.10);
    case 'INDEX':
      return Math.max(10.0, zoneWidth * 0.10);
    case 'CRYPTO':
      if (upper.startsWith('BTC')) {
        return Math.max(35.0, zoneWidth * 0.10);
      }
      if (upper.startsWith('ETH')) {
        return Math.max(3.50, zoneWidth * 0.10);
      }
      if (upper.startsWith('SOL')) {
        return Math.max(0.35, zoneWidth * 0.10);
      }
      return Math.max(pip * 5, zoneWidth * 0.10);
    default:
      return Math.max(2.0 * pip, zoneWidth * 0.10);
  }
}

/**
 * SMC Model A: 50% Consequent Encroachment (Equilibrium / Midpoint) + Dynamic Stop Plan
 */
export function calculateCeEntry(params: CeEntryCalculationOptions): CeEntryPlan {
  const { direction, zoneLow, zoneHigh, symbol } = params;
  const entryModel = params.entryModel ?? 'midpoint';
  const targetRMultiple = params.targetRMultiple ?? 2.0;
  const zoneWidth = Math.abs(zoneHigh - zoneLow);
  const pip = getPipSize(symbol);

  const buffer = params.dynamicBuffer !== false
    ? calculateDynamicStopBuffer(symbol, zoneLow, zoneHigh)
    : (params.invalidationBufferPips ?? 1.0) * pip;

  const isLong = direction === 'long';
  const entryPrice = entryModel === 'midpoint'
    ? zoneLow + zoneWidth * 0.5
    : (isLong ? zoneHigh : zoneLow);

  const stopPrice = isLong ? zoneLow - buffer : zoneHigh + buffer;
  const riskDistance = Math.abs(entryPrice - stopPrice);

  const tp1Price = isLong ? entryPrice + riskDistance * 1.0 : entryPrice - riskDistance * 1.0;
  const tp2Price = isLong ? entryPrice + riskDistance * 2.0 : entryPrice - riskDistance * 2.0;
  const tp3Price = isLong ? entryPrice + riskDistance * targetRMultiple : entryPrice - riskDistance * targetRMultiple;

  return Object.freeze({
    entryPrice,
    stopPrice,
    targetPrice: tp3Price,
    tp1Price,
    tp2Price,
    tp3Price,
    riskDistance,
    buffer,
    zoneLow,
    zoneHigh,
    entryModel,
    isLimit: entryModel === 'midpoint',
  });
}

/**
 * Detects runaway momentum / knife-catching candles breaching the zone without reaction.
 * If true, limit orders inside this zone should be cancelled.
 */
export function isSliceThroughCandle(
  direction: 'long' | 'short',
  candle: Candle,
  zoneLow: number,
  zoneHigh: number
): boolean {
  const range = Math.max(candle.high - candle.low, 1e-8);
  const body = Math.abs(candle.close - candle.open);
  const bodyRatio = body / range;

  if (direction === 'long') {
    // Bearish momentum breaching zoneLow
    const breached = candle.open > zoneLow && candle.close < zoneLow;
    if (!breached) return false;

    const lowerWick = Math.max(0, candle.close - candle.low);
    const lowerWickRatio = lowerWick / range;
    return bodyRatio >= 0.60 && lowerWickRatio <= 0.22;
  } else {
    // Bullish momentum breaching zoneHigh
    const breached = candle.open < zoneHigh && candle.close > zoneHigh;
    if (!breached) return false;

    const upperWick = Math.max(0, candle.high - candle.close);
    const upperWickRatio = upperWick / range;
    return bodyRatio >= 0.60 && upperWickRatio <= 0.22;
  }
}

/**
 * Evaluates whether a candle interacting with the zone showed defensive absorption / reaction.
 */
export function evaluateEntryCandleReaction(
  direction: 'long' | 'short',
  candle: Candle,
  zoneLow: number,
  zoneHigh: number
): boolean {
  const range = candle.high - candle.low;
  if (range <= 0) return true;

  const zoneWidth = Math.abs(zoneHigh - zoneLow);

  if (direction === 'long') {
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const lowerWickRatio = lowerWick / range;
    const isBullClose = candle.close >= candle.open;

    // Closed bearish deep in zone with negligible lower wick
    if (!isBullClose && lowerWickRatio < 0.15 && candle.close <= zoneLow + zoneWidth * 0.4) {
      return false;
    }
    return true;
  } else {
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const upperWickRatio = upperWick / range;
    const isBearClose = candle.close <= candle.open;

    // Closed bullish deep in zone with negligible upper wick
    if (!isBearClose && upperWickRatio < 0.15 && candle.close >= zoneHigh - zoneWidth * 0.4) {
      return false;
    }
    return true;
  }
}

export interface OneMinuteUnicornEvaluationInput {
  readonly direction: 'long' | 'short';
  readonly zoneLow: number;
  readonly zoneHigh: number;
  readonly symbol: string;
  readonly candles1m: readonly Candle[];
  readonly maxWait1mBars?: number;
  readonly requireFullUnicorn?: boolean;
}

export interface OneMinuteUnicornEvaluationResult {
  readonly confirmed: boolean;
  readonly reason: string;
  readonly filledBarIndex: number | null;
  readonly entryPrice: number | null;
  readonly stopLoss: number | null;
  readonly riskDistance: number | null;
  readonly tp1Price: number | null;
  readonly tp2Price: number | null;
  readonly has1mSweep: boolean;
  readonly has1mBreaker: boolean;
  readonly has1mIfvg: boolean;
}

/**
 * 🌺 CLT / checklisttrigger - 1M UNICORN SNIPER ENTRY MECHANISM
 * Combines 1M SFP (IDM Sweep), 1M Inversion FVG (iFVG), and 1M Breaker Block (MSS)
 * with dynamic 0.5 Fibonacci retracement execution and staggered TP (+1.0R BE + 3.0R TP2).
 */
export function evaluate1mUnicornSniperEntry(
  input: OneMinuteUnicornEvaluationInput
): OneMinuteUnicornEvaluationResult {
  const { direction, zoneLow, zoneHigh, symbol, candles1m } = input;
  const isLong = direction === 'long';
  const maxWait = input.maxWait1mBars ?? 60; // 60 1M bars max inside/after touch
  const pip = getPipSize(symbol);

  if (!candles1m || candles1m.length < 5) {
    return {
      confirmed: false,
      reason: 'INSUFFICIENT_1M_CANDLES',
      filledBarIndex: null,
      entryPrice: null,
      stopLoss: null,
      riskDistance: null,
      tp1Price: null,
      tp2Price: null,
      has1mSweep: false,
      has1mBreaker: false,
      has1mIfvg: false,
    };
  }

  // 1. Step: Detect first interaction with the 15M zone
  let touchIdx = -1;
  for (let i = 0; i < candles1m.length; i++) {
    const c = candles1m[i];
    const touched = isLong
      ? (c.low <= zoneHigh && c.high >= zoneLow)
      : (c.high >= zoneLow && c.low <= zoneHigh);
    if (touched) {
      touchIdx = i;
      break;
    }
  }

  if (touchIdx === -1) {
    return {
      confirmed: false,
      reason: 'ZONE_NOT_TOUCHED_BY_1M',
      filledBarIndex: null,
      entryPrice: null,
      stopLoss: null,
      riskDistance: null,
      tp1Price: null,
      tp2Price: null,
      has1mSweep: false,
      has1mBreaker: false,
      has1mIfvg: false,
    };
  }

  // 2. Step: Search for 1M SFP + iFVG + Breaker Block (Unicorn) within reaction window
  const searchLimit = Math.min(candles1m.length, touchIdx + maxWait);
  let unicornIdx = -1;
  let sweepLevel = 0;
  let detectedSweep = false;
  let detectedBreaker = false;
  let detectedIfvg = false;

  for (let k = touchIdx + 1; k < searchLimit; k++) {
    // 15M candle breach veto: 15 consecutive 1m bars closing beyond zone
    if (k >= touchIdx + 15) {
      const slice15 = candles1m.slice(k - 15, k);
      const allBreached = isLong
        ? slice15.every(c => c.close < zoneLow)
        : slice15.every(c => c.close > zoneHigh);
      if (allBreached) {
        return {
          confirmed: false,
          reason: 'VETO_15M_BAR_BREACH',
          filledBarIndex: null,
          entryPrice: null,
          stopLoss: null,
          riskDistance: null,
          tp1Price: null,
          tp2Price: null,
          has1mSweep: false,
          has1mBreaker: false,
          has1mIfvg: false,
        };
      }
    }

    const c = candles1m[k];
    const prevC = candles1m[k - 1];

    if (isLong) {
      // 1M SFP / IDM Sweep (Long): Swept prior 1M low and closed above it
      const lookbackStart = Math.max(0, k - 6);
      const priorLows = candles1m.slice(lookbackStart, k - 1).map(b => b.low);
      const localLow = priorLows.length > 0 ? Math.min(...priorLows) : prevC.low;

      const isSweep = (prevC.low < localLow && prevC.close > localLow) ||
                      (c.low < prevC.low && c.close > prevC.high);

      if (!isSweep) continue;

      // 1M Breaker Block / MSS: Closed above recent 1M swing high
      const priorHighs = candles1m.slice(Math.max(0, k - 4), k).map(b => b.high);
      const mssLevel = priorHighs.length > 0 ? Math.max(...priorHighs) : prevC.high;
      const isMss = c.close > mssLevel;
      if (!isMss) continue;

      // 1M Displacement check (body >= 40% of range)
      const range = Math.max(c.high - c.low, 1e-8);
      const body = Math.abs(c.close - c.open);
      if (body / range < 0.40) continue;

      // 1M iFVG: Bearish FVG inverted to bullish support
      let hasIfvg = false;
      for (let j = k - 1; j >= Math.max(2, k - 12); j--) {
        if (candles1m[j - 2].low > candles1m[j].high) {
          const fvgTop = candles1m[j - 2].low;
          if (c.close > fvgTop) {
            hasIfvg = true;
            break;
          }
        }
      }

      detectedSweep = true;
      detectedBreaker = true;
      detectedIfvg = hasIfvg;
      sweepLevel = c.low;

      if (!input.requireFullUnicorn || (detectedBreaker && detectedIfvg)) {
        unicornIdx = k;
        break;
      }
    } else {
      // 1M SFP / IDM Sweep (Short): Swept prior 1M high and closed below it
      const lookbackStart = Math.max(0, k - 6);
      const priorHighs = candles1m.slice(lookbackStart, k - 1).map(b => b.high);
      const localHigh = priorHighs.length > 0 ? Math.max(...priorHighs) : prevC.high;

      const isSweep = (prevC.high > localHigh && prevC.close < localHigh) ||
                      (c.high > prevC.high && c.close < prevC.low);

      if (!isSweep) continue;

      // 1M Breaker Block / MSS: Closed below recent 1M swing low
      const priorLows = candles1m.slice(Math.max(0, k - 4), k).map(b => b.low);
      const mssLevel = priorLows.length > 0 ? Math.min(...priorLows) : prevC.low;
      const isMss = c.close < mssLevel;
      if (!isMss) continue;

      // 1M Displacement
      const range = Math.max(c.high - c.low, 1e-8);
      const body = Math.abs(c.close - c.open);
      if (body / range < 0.40) continue;

      // 1M iFVG: Bullish FVG inverted to bearish resistance
      let hasIfvg = false;
      for (let j = k - 1; j >= Math.max(2, k - 12); j--) {
        if (candles1m[j].low > candles1m[j - 2].high) {
          const fvgBottom = candles1m[j - 2].high;
          if (c.close < fvgBottom) {
            hasIfvg = true;
            break;
          }
        }
      }

      detectedSweep = true;
      detectedBreaker = true;
      detectedIfvg = hasIfvg;
      sweepLevel = Math.max(c.high, prevC.high);

      if (!input.requireFullUnicorn || (detectedBreaker && detectedIfvg)) {
        unicornIdx = k;
        break;
      }
    }
  }

  if (unicornIdx === -1) {
    return {
      confirmed: false,
      reason: 'NO_1M_UNICORN_FORMATION',
      filledBarIndex: null,
      entryPrice: null,
      stopLoss: null,
      riskDistance: null,
      tp1Price: null,
      tp2Price: null,
      has1mSweep: detectedSweep,
      has1mBreaker: detectedBreaker,
      has1mIfvg: detectedIfvg,
    };
  }

  // 3. Step: Dynamic 0.5 Fibonacci retracement execution
  const anchorExtreme = sweepLevel;
  let anchorImpulse = isLong ? candles1m[unicornIdx].high : candles1m[unicornIdx].low;

  let filledBarIndex: number | null = null;
  let entryPrice = 0;
  let stopLoss = 0;
  let riskDistance = 0;

  for (let m = unicornIdx + 1; m < Math.min(candles1m.length, unicornIdx + 60); m++) {
    const mc = candles1m[m];
    if (isLong) {
      if (mc.high > anchorImpulse) {
        anchorImpulse = mc.high; // Fib expands if price rallies further without pullback
      }
      const fib05 = anchorExtreme + (anchorImpulse - anchorExtreme) * 0.5;
      if (mc.low <= fib05) {
        filledBarIndex = m;
        entryPrice = fib05;
        stopLoss = anchorExtreme - 1.5 * pip;
        riskDistance = Math.abs(entryPrice - stopLoss);
        break;
      }
    } else {
      if (mc.low < anchorImpulse) {
        anchorImpulse = mc.low; // Fib expands if price plunges further without pullback
      }
      const fib05 = anchorImpulse + (anchorExtreme - anchorImpulse) * 0.5;
      if (mc.high >= fib05) {
        filledBarIndex = m;
        entryPrice = fib05;
        stopLoss = anchorExtreme + 1.5 * pip;
        riskDistance = Math.abs(entryPrice - stopLoss);
        break;
      }
    }
  }

  if (filledBarIndex === null || riskDistance <= 0) {
    return {
      confirmed: false,
      reason: 'NO_0.5_FIB_RETEST',
      filledBarIndex: null,
      entryPrice: null,
      stopLoss: null,
      riskDistance: null,
      tp1Price: null,
      tp2Price: null,
      has1mSweep: detectedSweep,
      has1mBreaker: detectedBreaker,
      has1mIfvg: detectedIfvg,
    };
  }

  const tp1Price = isLong ? entryPrice + riskDistance * 1.0 : entryPrice - riskDistance * 1.0;
  const tp2Price = isLong ? entryPrice + riskDistance * 3.0 : entryPrice - riskDistance * 3.0;

  return {
    confirmed: true,
    reason: '1M_UNICORN_SNIPER_CONFIRMED',
    filledBarIndex,
    entryPrice,
    stopLoss,
    riskDistance,
    tp1Price,
    tp2Price,
    has1mSweep: detectedSweep,
    has1mBreaker: detectedBreaker,
    has1mIfvg: detectedIfvg,
  };
}
