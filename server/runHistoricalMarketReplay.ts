import * as fs from 'fs';
import * as path from 'path';
import {
  HistoricalMarketReplayDataset,
  runHistoricalMarketReplay,
} from '../src/historicalMarketReplay';
import { StoredCandle } from './candleStore';
import { ALL_SYMBOLS, Symbol } from './universe';

function main(): void {
  const symbol = readSymbol(process.env.REPLAY_SYMBOL ?? 'EURUSD');
  const dataset = {
    symbol,
    candles15m: readCandles(process.env.REPLAY_15M_FILE ?? `data/${symbol}_15m.json`),
    candles1h: readCandles(process.env.REPLAY_1H_FILE ?? `data/${symbol}_1h.json`),
    candles4h: readCandles(process.env.REPLAY_4H_FILE ?? `data/${symbol}_4h.json`),
  } satisfies HistoricalMarketReplayDataset;

  const startedTimestamp = optionalNumber(process.env.REPLAY_STARTED_TIMESTAMP);
  const finishedTimestamp = optionalNumber(process.env.REPLAY_FINISHED_TIMESTAMP);
  const respectMarketWindow = optionalBoolean(process.env.REPLAY_RESPECT_MARKET_WINDOW, true);
  const respectKillzone = optionalBoolean(process.env.REPLAY_RESPECT_KILLZONE, true);

  const session = runHistoricalMarketReplay(dataset, {
    startedTimestamp,
    finishedTimestamp,
    respectMarketWindow,
    respectKillzone,
  });

  const outputFile = path.resolve(
    process.env.HISTORICAL_MARKET_REPLAY_REPORT_FILE ??
      'evidence/replay/historical-market-replay-report.json'
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(session, null, 2), 'utf8');

  console.log(`[HistoricalMarketReplay] report=${outputFile}`);
  console.log(
    `[HistoricalMarketReplay] symbol=${session.symbol} steps=${session.replayStepCount} ` +
      `candidates=${session.candidateCount} completed=${session.completedOutcomeCount} ` +
      `unresolved=${session.unresolvedOutcomeCount}`
  );
}

function readCandles(fileName: string): StoredCandle[] {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Historical market replay candle file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Historical market replay could not parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Historical market replay candle file must contain an array: ${filePath}`);
  }

  return parsed.map((value, index) => {
    if (!isStoredCandle(value)) {
      throw new Error(`Historical market replay candle ${index} in ${filePath} is invalid.`);
    }
    return value;
  });
}

function isStoredCandle(value: unknown): value is StoredCandle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(candidate.timestamp) &&
    Number.isFinite(candidate.open) &&
    Number.isFinite(candidate.high) &&
    Number.isFinite(candidate.low) &&
    Number.isFinite(candidate.close);
}

function readSymbol(value: string): Symbol {
  if (!ALL_SYMBOLS.includes(value as Symbol)) {
    throw new Error(`Unsupported REPLAY_SYMBOL: ${value}`);
  }
  return value as Symbol;
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

main();
