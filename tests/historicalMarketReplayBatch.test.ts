import {
  HistoricalMarketReplayDataset,
  HistoricalMarketReplayBatchDataset,
  runHistoricalMarketReplayBatch,
} from '../src/historicalMarketReplayBatch';

function emptyDataset(symbol: 'EURUSD' | 'GBPUSD'): HistoricalMarketReplayBatchDataset {
  const dataset: HistoricalMarketReplayDataset = {
    symbol,
    candles15m: [],
    candles1h: [],
    candles4h: [],
  };

  return { symbol, dataset };
}

describe('historical market replay batch', () => {
  it('runs every supplied dataset and aggregates empty sessions deterministically', () => {
    const progress: string[] = [];

    const report = runHistoricalMarketReplayBatch(
      [emptyDataset('EURUSD'), emptyDataset('GBPUSD')],
      {
        respectMarketWindow: false,
        respectKillzone: false,
        onSession: (session, symbol, completed, total) => {
          progress.push(`${completed}/${total}:${symbol}:${session.replayStatus}`);
        },
      }
    );

    expect(report.batchVersion).toBe(1);
    expect(report.results.map(result => result.symbol)).toEqual(['EURUSD', 'GBPUSD']);
    expect(progress).toEqual(['1/2:EURUSD:EMPTY', '2/2:GBPUSD:EMPTY']);
    expect(report.aggregate).toEqual({
      symbolsAttempted: 2,
      symbolsCompleted: 0,
      replaySteps: 0,
      candidates: 0,
      takeProfit: 0,
      stopLoss: 0,
      expired: 0,
      unresolved: 0,
      resolvedDirectionOutcomes: 0,
      resolvedWinRate: null,
    });
  });

  it('rejects a dataset whose item symbol does not match the dataset symbol', () => {
    const mismatched: HistoricalMarketReplayBatchDataset = {
      symbol: 'EURUSD',
      dataset: {
        symbol: 'GBPUSD',
        candles15m: [],
        candles1h: [],
        candles4h: [],
      },
    };

    expect(() => runHistoricalMarketReplayBatch([mismatched])).toThrow(
      'dataset symbol mismatch'
    );
  });
});
