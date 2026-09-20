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

  const isActive = (lifecycle: Lifecycle): boolean => lifecycle.lifecycle === 'ACTIVE';

  if (input.tradeDirection === 'long') {
    const entryTop = input.entryZone.high;
    const maxObstaclePrice = entryTop + clearanceUnits;

    for (const ob of input.activeOrderBlocks15m) {
      if (ob.direction !== 'bearish' || ob.low <= entryTop || ob.low > maxObstaclePrice) continue;
      const lifecycle = getLifecycle(
        ob.formedAtIndex,
        ob.low,
        ob.high,
        input.candles15m,
        input.currentIndex15m,
        'bearish'
      );
      if (!isActive(lifecycle)) continue;
      const dist = roundPips((ob.low - entryTop) / pip);
      return {
        hasObstacle: true,
        obstacleType: 'OB',
        timeframe: '15m',
        level: { low: ob.low, high: ob.high },
        distancePips: dist,
        ...lifecycle,
        warningText: 'Karsi Engel: ' + dist + ' pip yukarida 15M Bearish OB mevcut (' + ob.low.toFixed(4) + ' - ' + ob.high.toFixed(4) + ')',
      };
    }

    for (const fvg of input.activeFVGs15m) {
      if (fvg.direction !== 'bearish' || fvg.gapLow <= entryTop || fvg.gapLow > maxObstaclePrice) continue;
      const lifecycle = getLifecycle(
        fvg.middleCandleIndex,
        fvg.gapLow,
        fvg.gapHigh,
        input.candles15m,
        input.currentIndex15m,
        'bearish'
      );
      if (!isActive(lifecycle)) continue;
      const dist = roundPips((fvg.gapLow - entryTop) / pip);
      return {
        hasObstacle: true,
        obstacleType: 'FVG',
        timeframe: '15m',
        level: { low: fvg.gapLow, high: fvg.gapHigh },
        distancePips: dist,
        ...lifecycle,
        warningText: 'Karsi Engel: ' + dist + ' pip yukarida 15M Bearish FVG mevcut (' + fvg.gapLow.toFixed(4) + ' - ' + fvg.gapHigh.toFixed(4) + ')',
      };
    }

    return find1hLongObstacle(input, entryTop, maxObstaclePrice, pip) ?? noObstacle;
  }

  const entryBottom = input.entryZone.low;
  const minObstaclePrice = entryBottom - clearanceUnits;

  for (const ob of input.activeOrderBlocks15m) {
    if (ob.direction !== 'bullish' || ob.high >= entryBottom || ob.high < minObstaclePrice) continue;
    const lifecycle = getLifecycle(
      ob.formedAtIndex,
      ob.low,
      ob.high,
      input.candles15m,
      input.currentIndex15m,
      'bullish'
    );
    if (!isActive(lifecycle)) continue;
    const dist = roundPips((entryBottom - ob.high) / pip);
    return {
      hasObstacle: true,
      obstacleType: 'OB',
      timeframe: '15m',
      level: { low: ob.low, high: ob.high },
      distancePips: dist,
      ...lifecycle,
      warningText: 'Karsi Engel: ' + dist + ' pip asagida 15M Bullish OB mevcut (' + ob.low.toFixed(4) + ' - ' + ob.high.toFixed(4) + ')',
    };
  }

  for (const fvg of input.activeFVGs15m) {
    if (fvg.direction !== 'bullish' || fvg.gapHigh >= entryBottom || fvg.gapHigh < minObstaclePrice) continue;
    const lifecycle = getLifecycle(
      fvg.middleCandleIndex,
      fvg.gapLow,
      fvg.gapHigh,
      input.candles15m,
      input.currentIndex15m,
      'bullish'
    );
    if (!isActive(lifecycle)) continue;
    const dist = roundPips((entryBottom - fvg.gapHigh) / pip);
    return {
      hasObstacle: true,
      obstacleType: 'FVG',
      timeframe: '15m',
      level: { low: fvg.gapLow, high: fvg.gapHigh },
      distancePips: dist,
      ...lifecycle,
      warningText: 'Karsi Engel: ' + dist + ' pip asagida 15M Bullish FVG mevcut (' + fvg.gapLow.toFixed(4) + ' - ' + fvg.gapHigh.toFixed(4) + ')',
    };
  }

  return find1hShortObstacle(input, entryBottom, minObstaclePrice, pip) ?? noObstacle;
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
