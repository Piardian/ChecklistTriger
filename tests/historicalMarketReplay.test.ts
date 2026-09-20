import { NotificationCandidate } from '../server/pipeline';
import * as pipelineModule from '../server/pipeline';
import { createSignalContext } from '../src/signalContext';
import { runHistoricalMarketReplay } from '../src/historicalMarketReplay';
import { OrderBlock, StructureEvent } from '../src/types';

function createDataset() {
  return {
    symbol: 'EURUSD' as const,
    candles15m: [
      candle(1000, 100, 100, 99, 99.5),
      candle(2000, 99.5, 100.5, 99, 100),
      candle(3000, 100, 100.5, 99.5, 100),
      candle(4000, 100, 104.5, 99.8, 104),
    ],
    candles1h: [
      candle(500, 100, 101, 99, 100),
      candle(2500, 100, 101, 99, 100),
    ],
    candles4h: [
      candle(250, 100, 102, 98, 100),
      candle(2250, 100, 103, 98, 101),
    ],
  };
}

describe('Historical Market Replay', () => {
  it('passes the replay cursor into the default pipeline candidate generator', () => {
    const dataset = createDataset();
    const runPipelineSpy = jest.spyOn(pipelineModule, 'runPipeline').mockReturnValue([]);

    runHistoricalMarketReplay(dataset, {
      startedTimestamp: 1000,
      finishedTimestamp: 4000,
      respectMarketWindow: false,
      respectKillzone: false,
    });

    expect(runPipelineSpy.mock.calls.map(call => call[3])).toEqual([1000, 2000, 3000, 4000]);
    runPipelineSpy.mockRestore();
  });

  it('never exposes candles after the current replay timestamp to candidate generation', () => {
    const dataset = createDataset();
    const observed = [] as Array<{
      replayTimestamp: number;
      last15m: number | null;
      last1h: number | null;
      last4h: number | null;
    }>;

    const replay = runHistoricalMarketReplay(dataset, {
      startedTimestamp: 1000,
      finishedTimestamp: 4000,
      respectMarketWindow: false,
      respectKillzone: false,
      candidateGenerator: ({ candleStore, replayTimestamp }) => {
        observed.push({
          replayTimestamp,
          last15m: lastTimestamp(candleStore.getCandles('EURUSD', '15m')),
          last1h: lastTimestamp(candleStore.getCandles('EURUSD', '1h')),
          last4h: lastTimestamp(candleStore.getCandles('EURUSD', '4h')),
        });
        return [];
      },
    });

    expect(replay.replayStepCount).toBe(4);
    expect(observed).toEqual([
      { replayTimestamp: 1000, last15m: 1000, last1h: 500, last4h: 250 },
      { replayTimestamp: 2000, last15m: 2000, last1h: 500, last4h: 250 },
      { replayTimestamp: 3000, last15m: 3000, last1h: 2500, last4h: 2250 },
      { replayTimestamp: 4000, last15m: 4000, last1h: 2500, last4h: 2250 },
    ]);
  });

  it('evaluates a newly discovered candidate only against candles after the replay cursor and deduplicates it', () => {
    const dataset = createDataset();
    const candidate = createCandidate();

    const replay = runHistoricalMarketReplay(dataset, {
      startedTimestamp: 1000,
      finishedTimestamp: 4000,
      respectMarketWindow: false,
      respectKillzone: false,
      outcomeOptions: {
        entryWindowBars: 2,
        maxHoldBars: 2,
      },
      candidateGenerator: ({ replayTimestamp }) =>
        replayTimestamp >= 2000 ? [candidate] : [],
    });

    expect(replay.candidateCount).toBe(1);
    expect(replay.completedOutcomeCount).toBe(1);
    expect(replay.unresolvedOutcomeCount).toBe(0);
    expect(replay.trades).toHaveLength(1);
    expect(replay.trades[0]).toMatchObject({
      signalId: 'REPLAY_SIGNAL_1',
      detectedTimestamp: 2000,
      outcomeStatus: 'TAKE_PROFIT',
      entryTriggeredAt: 3000,
      exitTimestamp: 4000,
      rrAchieved: 2,
      evaluatedCandles: 2,
    });
  });

  it('does not invent an outcome when the future dataset ends before the configured evaluation window', () => {
    const dataset = createDataset();
    const candidate = createCandidate();

    const replay = runHistoricalMarketReplay(dataset, {
      startedTimestamp: 2000,
      finishedTimestamp: 3000,
      respectMarketWindow: false,
      respectKillzone: false,
      candidateGenerator: ({ replayTimestamp }) =>
        replayTimestamp === 2000 ? [candidate] : [],
    });

    expect(replay.candidateCount).toBe(1);
    expect(replay.completedOutcomeCount).toBe(0);
    expect(replay.unresolvedOutcomeCount).toBe(1);
    expect(replay.trades[0].outcomeStatus).toBe('UNRESOLVED');
    expect(replay.trades[0].exitTimestamp).toBeNull();
  });

  it('rejects a candidate that claims an observation timestamp in the future', () => {
    const dataset = createDataset();
    const candidate = createCandidate({ validationCloseTimestamp: 3001 });

    expect(() =>
      runHistoricalMarketReplay(dataset, {
        startedTimestamp: 2000,
        finishedTimestamp: 4000,
        respectMarketWindow: false,
        respectKillzone: false,
        candidateGenerator: ({ replayTimestamp }) =>
          replayTimestamp === 2000 ? [candidate] : [],
      })
    ).toThrow(
      'Historical market replay detected future candidate data for REPLAY_SIGNAL_1: candidate observation 3001 > replay timestamp 2000.'
    );
  });
});

function createCandidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  const signalContext = createSignalContext({
    signalId: 'REPLAY_SIGNAL_1',
    pair: 'EURUSD',
    direction: 'long',
    timeframe: '15m',
    grade: 'A',
    score: 7,
    timestamp: 2000,
    lifecycleStates: ['DETECTED', 'GRADED'],
  });
  const relatedEvent = createStructureEvent();
  const poi: OrderBlock = {
    direction: 'bullish',
    candleIndex: 1,
    high: 101,
    low: 99,
    formedAtIndex: 1,
    relatedEvent,
  };
  const gradeResult = {
    totalScore: 7,
    grade: 'A' as const,
    entryAllowed: true,
    blockReasons: [],
    breakdown: {
      htfBiasPD: 2,
      displacement: 2,
      structure: 1,
      sweep: 1,
      poiQuality: 1,
    },
  };

  return {
    symbol: 'EURUSD',
    tradeDirection: 'long',
    poiType: 'OB',
    poi,
    gradeResult,
    uniqueKey: 'REPLAY_SIGNAL_1',
    dedupeKey: 'REPLAY_DEDUPE_1',
    signalId: 'REPLAY_SIGNAL_1',
    signalContext,
    currentPrice: 100,
    marketDataTimestamp: 2000,
    poiFormedTimestamp: 1000,
    poiTimeframe: '15m',
    validationClosePrice: 100,
    validationCloseTimestamp: 2000,
    bias4H: 'bullish',
    bias1H: 'bullish',
    poiTestCount: 0,
    pd4H: 'discount',
    pd1H: 'discount',
    pd15M: 'discount',
    ...overrides,
  };
}

function createStructureEvent(): StructureEvent {
  return {
    type: 'BOS',
    direction: 'bullish',
    brokenSwing: {
      type: 'high',
      price: 100,
      formedAtIndex: 0,
      confirmedAtIndex: 1,
      timestamp: 1000,
    },
    breakCandleIndex: 1,
    breakTimestamp: 2000,
    breakClosePrice: 100,
  };
}

function candle(timestamp: number, open: number, high: number, low: number, close: number) {
  return { timestamp, open, high, low, close };
}

function lastTimestamp(candles: readonly { timestamp: number }[]): number | null {
  return candles.length === 0 ? null : candles[candles.length - 1].timestamp;
}
