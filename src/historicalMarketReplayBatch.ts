import {
  HistoricalMarketReplayDataset,
  HistoricalMarketReplayOptions,
  HistoricalMarketReplaySession,
  runHistoricalMarketReplay,
} from './historicalMarketReplay';
import { Symbol, universeCohort } from '../server/universe';

export { HistoricalMarketReplayDataset } from './historicalMarketReplay';

export const HISTORICAL_MARKET_REPLAY_BATCH_VERSION = 1 as const;

export interface HistoricalMarketReplayBatchDataset {
  readonly symbol: Symbol;
  readonly dataset: HistoricalMarketReplayDataset;
}

export interface HistoricalMarketReplayBatchSymbolResult {
  readonly symbol: Symbol;
  readonly cohort: ReturnType<typeof universeCohort>;
  readonly session: HistoricalMarketReplaySession;
}

export interface HistoricalMarketReplayBatchAggregate {
  readonly symbolsAttempted: number;
  readonly symbolsCompleted: number;
  readonly replaySteps: number;
  readonly candidates: number;
  readonly takeProfit: number;
  readonly stopLoss: number;
  readonly expired: number;
  readonly unresolved: number;
  readonly resolvedDirectionOutcomes: number;
  readonly resolvedWinRate: number | null;
}

export interface HistoricalMarketReplayBatchReport {
  readonly batchVersion: typeof HISTORICAL_MARKET_REPLAY_BATCH_VERSION;
  readonly results: readonly HistoricalMarketReplayBatchSymbolResult[];
  readonly aggregate: HistoricalMarketReplayBatchAggregate;
}

export interface HistoricalMarketReplayBatchOptions extends HistoricalMarketReplayOptions {
  readonly onSession?: (
    session: HistoricalMarketReplaySession,
    symbol: Symbol,
    completedIndex: number,
    totalSymbols: number
  ) => void;
}

export function runHistoricalMarketReplayBatch(
  datasets: readonly HistoricalMarketReplayBatchDataset[],
  options: HistoricalMarketReplayBatchOptions = {}
): HistoricalMarketReplayBatchReport {
  const results: HistoricalMarketReplayBatchSymbolResult[] = [];
  const totalSymbols = datasets.length;

  datasets.forEach((item, index) => {
    if (item.dataset.symbol !== item.symbol) {
      throw new Error(
        `Historical market replay batch dataset symbol mismatch: item=${item.symbol}, dataset=${item.dataset.symbol}.`
      );
    }

    const sessionOptions: HistoricalMarketReplayOptions = { ...options };
    delete (sessionOptions as { onSession?: unknown }).onSession;

    const session = runHistoricalMarketReplay(item.dataset, sessionOptions);
    results.push(
      Object.freeze({
        symbol: item.symbol,
        cohort: universeCohort(item.symbol),
        session,
      })
    );
    options.onSession?.(session, item.symbol, index + 1, totalSymbols);
  });

  return Object.freeze({
    batchVersion: HISTORICAL_MARKET_REPLAY_BATCH_VERSION,
    results: Object.freeze(results),
    aggregate: Object.freeze(aggregateResults(results)),
  });
}

function aggregateResults(
  results: readonly HistoricalMarketReplayBatchSymbolResult[]
): HistoricalMarketReplayBatchAggregate {
  const trades = results.flatMap(result => result.session.trades);
  const takeProfit = trades.filter(trade => trade.outcomeStatus === 'TAKE_PROFIT').length;
  const stopLoss = trades.filter(trade => trade.outcomeStatus === 'STOP_LOSS').length;
  const expired = trades.filter(trade => trade.outcomeStatus === 'EXPIRED').length;
  const unresolved = trades.filter(trade => trade.outcomeStatus === 'UNRESOLVED').length;
  const resolvedDirectionOutcomes = takeProfit + stopLoss;

  return {
    symbolsAttempted: results.length,
    symbolsCompleted: results.filter(result => result.session.replayStatus === 'COMPLETED').length,
    replaySteps: results.reduce((sum, result) => sum + result.session.replayStepCount, 0),
    candidates: trades.length,
    takeProfit,
    stopLoss,
    expired,
    unresolved,
    resolvedDirectionOutcomes,
    resolvedWinRate:
      resolvedDirectionOutcomes === 0
        ? null
        : takeProfit / resolvedDirectionOutcomes,
  };
}
