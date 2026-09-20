import { OrderBlock, FVG } from './types';
import { getPipSize, detectAssetClass } from './assetMetrics';

export interface OpposingObstacle {
  hasObstacle: boolean;
  obstacleType: 'OB' | 'FVG' | null;
  timeframe: '15m' | '1h';
  level: { low: number; high: number } | null;
  distancePips: number;
  lifecycle?: 'ACTIVE' | 'MITIGATED' | 'INVALIDATED' | 'NONE';
  firstMitigationAt?: number | null;
  invalidatedAt?: number | null;
  warningText: string;
}

export interface ObstacleCheckInput {
  symbol: string;
  tradeDirection: 'long' | 'short';
  entryZone: { low: number; high: number };
  activeOrderBlocks15m: readonly OrderBlock[];
  activeFVGs15m: readonly FVG[];
  activeOrderBlocks1h?: readonly OrderBlock[];
  activeFVGs1h?: readonly FVG[];
  candles15m?: readonly MarketCandle[];
  candles1h?: readonly MarketCandle[];
  currentIndex15m?: number;
  currentIndex1h?: number;
  minClearancePips?: number;
}

interface MarketCandle {
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

interface Lifecycle {
  lifecycle: OpposingObstacle['lifecycle'];
  firstMitigationAt: number | null;
  invalidatedAt: number | null;
}

function getDefaultClearancePips(symbol: string): number {
  const assetClass = detectAssetClass(symbol);
  switch (assetClass) {
    case 'FOREX':
      return 25;
    case 'FOREX_JPY':
      return 35;
    case 'CRYPTO':
      return 500;
    default:
      return 30;
  }
}

export function detectOpposingObstacle(input: ObstacleCheckInput): OpposingObstacle {
  const pip = getPipSize(input.symbol);
  const clearancePips = input.minClearancePips ?? getDefaultClearancePips(input.symbol);
  const clearanceUnits = clearancePips * pip;

  const noObstacle: OpposingObstacle = {
    hasObstacle: false,
    obstacleType: null,
    timeframe: '15m',
    level: null,
    distancePips: 0,
    lifecycle: 'NONE',
    firstMitigationAt: null,
    invalidatedAt: null,
    warningText: '',
  };

  if (input.tradeDirection === 'long') {
    const entryBoundary = input.entryZone.high;
    const maxPrice = entryBoundary + clearanceUnits;
    const obstacle15m = selectNearestActiveObstacle(
      collect15mLongCandidates(input, entryBoundary, maxPrice, pip),
      input
    );
    if (obstacle15m) return obstacle15m;
    return find1hLongObstacle(input, entryBoundary, maxPrice, pip) ?? noObstacle;
  }

  const entryBoundary = input.entryZone.low;
  const minPrice = entryBoundary - clearanceUnits;
  const obstacle15m = selectNearestActiveObstacle(
    collect15mShortCandidates(input, entryBoundary, minPrice, pip),
    input
  );
  if (obstacle15m) return obstacle15m;
  return find1hShortObstacle(input, entryBoundary, minPrice, pip) ?? noObstacle;
}

interface ObstacleCandidate {
  obstacleType: 'OB' | 'FVG';
  timeframe: '15m' | '1h';
  level: { low: number; high: number };
  distancePips: number;
  formedAtIndex: number;
  direction: 'bullish' | 'bearish';
  lifecycle: Lifecycle;
}

function collect15mLongCandidates(
  input: ObstacleCheckInput,
  entryTop: number,
  maxObstaclePrice: number,
  pip: number
): ObstacleCandidate[] {
  const candidates: ObstacleCandidate[] = [];
  for (const ob of input.activeOrderBlocks15m) {
    if (ob.direction !== 'bearish' || ob.low <= entryTop || ob.low > maxObstaclePrice) continue;
    const lifecycle = getLifecycle(ob.formedAtIndex, ob.low, ob.high, input.candles15m, input.currentIndex15m, 'bearish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    candidates.push({
      obstacleType: 'OB',
      timeframe: '15m',
      level: { low: ob.low, high: ob.high },
      distancePips: roundPips((ob.low - entryTop) / pip),
      formedAtIndex: ob.formedAtIndex,
      direction: 'bearish',
      lifecycle,
    });
  }
  for (const fvg of input.activeFVGs15m) {
    if (fvg.direction !== 'bearish' || fvg.gapLow <= entryTop || fvg.gapLow > maxObstaclePrice) continue;
    const lifecycle = getLifecycle(fvg.middleCandleIndex, fvg.gapLow, fvg.gapHigh, input.candles15m, input.currentIndex15m, 'bearish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    candidates.push({
      obstacleType: 'FVG',
      timeframe: '15m',
      level: { low: fvg.gapLow, high: fvg.gapHigh },
      distancePips: roundPips((fvg.gapLow - entryTop) / pip),
      formedAtIndex: fvg.middleCandleIndex,
      direction: 'bearish',
      lifecycle,
    });
  }
  return candidates;
}

function collect15mShortCandidates(
  input: ObstacleCheckInput,
  entryBottom: number,
  minObstaclePrice: number,
  pip: number
): ObstacleCandidate[] {
  const candidates: ObstacleCandidate[] = [];
  for (const ob of input.activeOrderBlocks15m) {
    if (ob.direction !== 'bullish' || ob.high >= entryBottom || ob.high < minObstaclePrice) continue;
    const lifecycle = getLifecycle(ob.formedAtIndex, ob.low, ob.high, input.candles15m, input.currentIndex15m, 'bullish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    candidates.push({
      obstacleType: 'OB',
      timeframe: '15m',
      level: { low: ob.low, high: ob.high },
      distancePips: roundPips((entryBottom - ob.high) / pip),
      formedAtIndex: ob.formedAtIndex,
      direction: 'bullish',
      lifecycle,
    });
  }
  for (const fvg of input.activeFVGs15m) {
    if (fvg.direction !== 'bullish' || fvg.gapHigh >= entryBottom || fvg.gapHigh < minObstaclePrice) continue;
    const lifecycle = getLifecycle(fvg.middleCandleIndex, fvg.gapLow, fvg.gapHigh, input.candles15m, input.currentIndex15m, 'bullish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    candidates.push({
      obstacleType: 'FVG',
      timeframe: '15m',
      level: { low: fvg.gapLow, high: fvg.gapHigh },
      distancePips: roundPips((entryBottom - fvg.gapHigh) / pip),
      formedAtIndex: fvg.middleCandleIndex,
      direction: 'bullish',
      lifecycle,
    });
  }
  return candidates;
}

function selectNearestActiveObstacle(
  candidates: readonly ObstacleCandidate[],
  input: ObstacleCheckInput
): OpposingObstacle | null {
  if (candidates.length === 0) return null;
  const rankType = (type: ObstacleCandidate['obstacleType']): number => type === 'OB' ? 0 : 1;
  const selected = [...candidates].sort((a, b) =>
    a.distancePips - b.distancePips ||
    rankType(a.obstacleType) - rankType(b.obstacleType) ||
    a.formedAtIndex - b.formedAtIndex ||
    a.level.low - b.level.low ||
    a.level.high - b.level.high
  )[0];

  const timeframeText = selected.timeframe === '15m' ? '15M' : '1H';
  const directionText = selected.direction === 'bearish' ? 'Bearish' : 'Bullish';
  const sideText = input.tradeDirection === 'long' ? 'yukarida' : 'asagida';
  const priceText = selected.level.low.toFixed(4) + ' - ' + selected.level.high.toFixed(4);

  return {
    hasObstacle: true,
    obstacleType: selected.obstacleType,
    timeframe: selected.timeframe,
    level: selected.level,
    distancePips: selected.distancePips,
    ...selected.lifecycle,
    warningText: 'Karsi Engel: ' + selected.distancePips + ' pip ' + sideText + ' ' +
      timeframeText + ' ' + directionText + ' ' + selected.obstacleType +
      ' mevcut (' + priceText + ')',
  };
}

function find1hLongObstacle(
  input: ObstacleCheckInput,
  entryTop: number,
  maxObstaclePrice: number,
  pip: number
): OpposingObstacle | null {
  for (const ob of input.activeOrderBlocks1h ?? []) {
    if (ob.direction !== 'bearish' || ob.low <= entryTop || ob.low > maxObstaclePrice) continue;
    const lifecycle = getLifecycle(ob.formedAtIndex, ob.low, ob.high, input.candles1h, input.currentIndex1h, 'bearish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    const dist = roundPips((ob.low - entryTop) / pip);
    return {
      hasObstacle: true,
      obstacleType: 'OB',
      timeframe: '1h',
      level: { low: ob.low, high: ob.high },
      distancePips: dist,
      ...lifecycle,
      warningText: 'Karsi Engel: ' + dist + ' pip yukarida 1H Bearish OB mevcut (' + ob.low.toFixed(4) + ' - ' + ob.high.toFixed(4) + ')',
    };
  }

  for (const fvg of input.activeFVGs1h ?? []) {
    if (fvg.direction !== 'bearish' || fvg.gapLow <= entryTop || fvg.gapLow > maxObstaclePrice) continue;
    const lifecycle = getLifecycle(fvg.middleCandleIndex, fvg.gapLow, fvg.gapHigh, input.candles1h, input.currentIndex1h, 'bearish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    const dist = roundPips((fvg.gapLow - entryTop) / pip);
    return {
      hasObstacle: true,
      obstacleType: 'FVG',
      timeframe: '1h',
      level: { low: fvg.gapLow, high: fvg.gapHigh },
      distancePips: dist,
      ...lifecycle,
      warningText: 'Karsi Engel: ' + dist + ' pip yukarida 1H Bearish FVG mevcut (' + fvg.gapLow.toFixed(4) + ' - ' + fvg.gapHigh.toFixed(4) + ')',
    };
  }

  return null;
}

function find1hShortObstacle(
  input: ObstacleCheckInput,
  entryBottom: number,
  minObstaclePrice: number,
  pip: number
): OpposingObstacle | null {
  for (const ob of input.activeOrderBlocks1h ?? []) {
    if (ob.direction !== 'bullish' || ob.high >= entryBottom || ob.high < minObstaclePrice) continue;
    const lifecycle = getLifecycle(ob.formedAtIndex, ob.low, ob.high, input.candles1h, input.currentIndex1h, 'bullish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    const dist = roundPips((entryBottom - ob.high) / pip);
    return {
      hasObstacle: true,
      obstacleType: 'OB',
      timeframe: '1h',
      level: { low: ob.low, high: ob.high },
      distancePips: dist,
      ...lifecycle,
      warningText: 'Karsi Engel: ' + dist + ' pip asagida 1H Bullish OB mevcut (' + ob.low.toFixed(4) + ' - ' + ob.high.toFixed(4) + ')',
    };
  }

  for (const fvg of input.activeFVGs1h ?? []) {
    if (fvg.direction !== 'bullish' || fvg.gapHigh >= entryBottom || fvg.gapHigh < minObstaclePrice) continue;
    const lifecycle = getLifecycle(fvg.middleCandleIndex, fvg.gapLow, fvg.gapHigh, input.candles1h, input.currentIndex1h, 'bullish');
    if (lifecycle.lifecycle !== 'ACTIVE') continue;
    const dist = roundPips((entryBottom - fvg.gapHigh) / pip);
    return {
      hasObstacle: true,
      obstacleType: 'FVG',
      timeframe: '1h',
      level: { low: fvg.gapLow, high: fvg.gapHigh },
      distancePips: dist,
      ...lifecycle,
      warningText: 'Karsi Engel: ' + dist + ' pip asagida 1H Bullish FVG mevcut (' + fvg.gapLow.toFixed(4) + ' - ' + fvg.gapHigh.toFixed(4) + ')',
    };
  }

  return null;
}

function getLifecycle(
  formedAtIndex: number,
  low: number,
  high: number,
  candles: readonly MarketCandle[] | undefined,
  currentIndex: number | undefined,
  direction: 'bullish' | 'bearish'
): Lifecycle {
  if (!candles || currentIndex === undefined) {
    return { lifecycle: 'ACTIVE', firstMitigationAt: null, invalidatedAt: null };
  }

  let firstMitigationAt: number | null = null;
  let invalidatedAt: number | null = null;
  const startIndex = Math.max(formedAtIndex + 1, 0);
  const endIndex = Math.min(currentIndex, candles.length - 1);

  for (let index = startIndex; index <= endIndex; index += 1) {
    const candle = candles[index];
    const invalidated = direction === 'bearish'
      ? candle.close > high
      : candle.close < low;
    if (invalidated) {
      invalidatedAt = candle.timestamp;
      break;
    }

    const touched = candle.low <= high && candle.high >= low;
    if (touched && firstMitigationAt === null) {
      firstMitigationAt = candle.timestamp;
    }
  }

  return {
    lifecycle: invalidatedAt !== null
      ? 'INVALIDATED'
      : firstMitigationAt !== null
        ? 'MITIGATED'
        : 'ACTIVE',
    firstMitigationAt,
    invalidatedAt,
  };
}

function roundPips(value: number): number {
  return Math.round(value * 10) / 10;
}
