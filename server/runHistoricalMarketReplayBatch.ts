import * as fs from 'fs';
import * as path from 'path';
import {
  HistoricalMarketReplayBatchDataset,
  HistoricalMarketReplayBatchReport,
  runHistoricalMarketReplayBatch,
} from '../src/historicalMarketReplayBatch';
import { StoredCandle } from './candleStore';
import { ALL_SYMBOLS, Symbol } from './universe';

const REPLAY_SYMBOLS = ALL_SYMBOLS;
type ReplaySymbol = (typeof REPLAY_SYMBOLS)[number];

interface InputIssue {
  readonly symbol: string;
  readonly error: string;
}

interface BatchRunReport {
  readonly batch: HistoricalMarketReplayBatchReport;
  readonly inputIssues: readonly InputIssue[];
}

function main(): void {
  const symbols = readSymbols(process.env.REPLAY_SYMBOLS);
  const dataDir = path.resolve(process.env.REPLAY_DATA_DIR ?? 'data');
  const datasets: HistoricalMarketReplayBatchDataset[] = [];
  const inputIssues: InputIssue[] = [];

  for (const symbol of symbols) {
    try {
      datasets.push({
        symbol,
        dataset: {
          symbol,
          candles15m: readCandles(path.join(dataDir, `${symbol}_15m.json`)),
          candles1h: readCandles(path.join(dataDir, `${symbol}_1h.json`)),
          candles4h: readCandles(path.join(dataDir, `${symbol}_4h.json`)),
        },
      });
    } catch (error) {
      inputIssues.push({
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sessionOptions = {
    startedTimestamp: optionalNumber(process.env.REPLAY_STARTED_TIMESTAMP),
    finishedTimestamp: optionalNumber(process.env.REPLAY_FINISHED_TIMESTAMP),
    respectMarketWindow: optionalBoolean(process.env.REPLAY_RESPECT_MARKET_WINDOW, true),
    respectKillzone: optionalBoolean(process.env.REPLAY_RESPECT_KILLZONE, true),
    outcomeOptions: undefined,
    onSession: (session: { symbol: Symbol; candidateCount: number }, symbol: Symbol, completed: number, total: number) => {
      console.log(
        `[HistoricalMarketReplayBatch] ${completed}/${total} ${symbol} ` +
        `steps=${session.candidateCount >= 0 ? 'done' : 'error'} candidates=${session.candidateCount}`
      );
    },
  };

  const batch = runHistoricalMarketReplayBatch(datasets, sessionOptions);
  const report: BatchRunReport = Object.freeze({
    batch,
    inputIssues: Object.freeze(inputIssues),
  });

  const outputFile = path.resolve(
    process.env.HISTORICAL_MARKET_REPLAY_BATCH_REPORT_FILE ??
      'evidence/replay/historical-market-replay-batch-report.json'
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('[HistoricalMarketReplayBatch] ===== SUMMARY =====');
  console.log(`[HistoricalMarketReplayBatch] requested=${symbols.length}`);
  console.log(`[HistoricalMarketReplayBatch] replayed=${batch.aggregate.symbolsCompleted}`);
  console.log(`[HistoricalMarketReplayBatch] inputIssues=${inputIssues.length}`);
  console.log(`[HistoricalMarketReplayBatch] candidates=${batch.aggregate.candidates}`);
  console.log(`[HistoricalMarketReplayBatch] takeProfit=${batch.aggregate.takeProfit}`);
  console.log(`[HistoricalMarketReplayBatch] stopLoss=${batch.aggregate.stopLoss}`);
  console.log(`[HistoricalMarketReplayBatch] expired=${batch.aggregate.expired}`);
  console.log(`[HistoricalMarketReplayBatch] unresolved=${batch.aggregate.unresolved}`);
  console.log(
    `[HistoricalMarketReplayBatch] resolvedWinRate=${formatRate(batch.aggregate.resolvedWinRate)}`
  );
  console.log(`[HistoricalMarketReplayBatch] report=${outputFile}`);

  if (inputIssues.length > 0) {
    console.log('[HistoricalMarketReplayBatch] ===== INPUT ISSUES =====');
    for (const issue of inputIssues) {
      console.log(`[HistoricalMarketReplayBatch] ${issue.symbol}: ${issue.error}`);
    }
  }
}

function readCandles(fileName: string): StoredCandle[] {
  if (!fs.existsSync(fileName)) {
    throw new Error(`candle file not found: ${fileName}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(fileName, 'utf8'));
  } catch (error) {
    throw new Error(
      `could not parse ${fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`candle file must contain an array: ${fileName}`);
  }

  return parsed.map((value, index) => {
    if (!isStoredCandle(value)) {
      throw new Error(`invalid candle at index ${index}: ${fileName}`);
    }
    return value;
  });
}

function isStoredCandle(value: unknown): value is StoredCandle {
  if (!value || typeof value !== 'object') return false;
  const candle = value as Record<string, unknown>;
  return Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume);
}

function readSymbols(value: string | undefined): ReplaySymbol[] {
  if (!value || value.trim() === '') return [...REPLAY_SYMBOLS];

  const requested = value
    .split(',')
    .map(symbol => symbol.trim().toUpperCase())
    .filter(Boolean);

  const unique = [...new Set(requested)];
  for (const symbol of unique) {
    if (!REPLAY_SYMBOLS.includes(symbol as ReplaySymbol)) {
      throw new Error(`Unsupported REPLAY_SYMBOLS entry: ${symbol}`);
    }
  }

  return unique as ReplaySymbol[];
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a finite numeric timestamp, received: ${value}`);
  }
  return parsed;
}

function optionalBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received: ${value}`);
}

function formatRate(rate: number | null): string {
  return rate === null ? 'N/A' : `${(rate * 100).toFixed(2)}%`;
}

main();
