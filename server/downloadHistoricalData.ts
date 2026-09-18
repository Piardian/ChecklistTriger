import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fetchHistoricalCandles } from './twelveDataClient';
import { StoredCandle, Timeframe } from './candleStore';
import { ALL_SYMBOLS, Symbol } from './universe';

const TIMEFRAMES: readonly Timeframe[] = ['15m', '1h', '4h'];
const CHUNK_DAYS: Readonly<Record<Timeframe, number>> = Object.freeze({
  '15m': 45,
  '1h': 180,
  '4h': 365,
  '1m': 7,
});

interface Config {
  readonly symbols: readonly Symbol[];
  readonly start: Date;
  readonly end: Date;
  readonly dataDir: string;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  await fs.mkdir(config.dataDir, { recursive: true });

  console.log(`[HistoricalData] range=${config.start.toISOString()} -> ${config.end.toISOString()}`);
  console.log(`[HistoricalData] symbols=${config.symbols.join(',')} timeframes=15m,1h,4h`);

  for (const symbol of config.symbols) {
    for (const timeframe of TIMEFRAMES) {
      const candles = await downloadTimeframe(symbol, timeframe, config.start, config.end);
      validateCandles(candles, timeframe, symbol);
      const file = path.join(config.dataDir, `${symbol}_${timeframe}.json`);
      await fs.writeFile(file, JSON.stringify(candles, null, 2) + '\n', 'utf8');
      console.log(`[HistoricalData] ${symbol} ${timeframe}: ${candles.length} candles -> ${file}`);
    }
  }
}

async function downloadTimeframe(
  symbol: Symbol,
  timeframe: Timeframe,
  start: Date,
  end: Date
): Promise<StoredCandle[]> {
  const merged = new Map<number, StoredCandle>();
  let chunkStart = new Date(start.getTime());
  const chunkMs = CHUNK_DAYS[timeframe] * 86_400_000;

  while (chunkStart <= end) {
    const chunkEnd = new Date(Math.min(end.getTime(), chunkStart.getTime() + chunkMs - 1));
    console.log(`[HistoricalData] fetch ${symbol} ${timeframe} ${chunkStart.toISOString()} -> ${chunkEnd.toISOString()}`);
    const candles = await fetchHistoricalCandles(
      symbol,
      timeframe,
      chunkStart.toISOString(),
      chunkEnd.toISOString()
    );

    for (const candle of candles) {
      if (candle.timestamp < start.getTime() || candle.timestamp > end.getTime()) continue;
      merged.set(candle.timestamp, candle);
    }

    chunkStart = new Date(chunkEnd.getTime() + 1);
  }

  return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function validateCandles(candles: readonly StoredCandle[], timeframe: Timeframe, symbol: Symbol): void {
  if (candles.length === 0) {
    throw new Error(`No historical candles returned for ${symbol} ${timeframe}.`);
  }

  const intervalMs = timeframe === '15m'
    ? 15 * 60_000
    : timeframe === '1h'
      ? 60 * 60_000
      : 4 * 60 * 60_000;

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    if (![c.timestamp, c.open, c.high, c.low, c.close].every(Number.isFinite)) {
      throw new Error(`Invalid non-finite candle at index ${i} for ${symbol} ${timeframe}.`);
    }
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      throw new Error(`Invalid non-positive price at index ${i} for ${symbol} ${timeframe}.`);
    }
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) {
      throw new Error(`Invalid OHLC relationship at index ${i} for ${symbol} ${timeframe}.`);
    }
    if (c.timestamp % intervalMs !== 0) {
      throw new Error(`Timestamp ${c.timestamp} is not aligned to ${timeframe} for ${symbol}.`);
    }
    if (i > 0 && c.timestamp <= candles[i - 1].timestamp) {
      throw new Error(`Historical candles are not strictly chronological for ${symbol} ${timeframe}.`);
    }
  }
}

function parseArgs(args: readonly string[]): Config {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) values.set(key, inlineValue);
    else {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      values.set(key, value);
      i += 1;
    }
  }

  const end = values.has('end') ? parseDate(values.get('end')!, '--end') : new Date();
  const start = values.has('start')
    ? parseDate(values.get('start')!, '--start')
    : monthsBefore(end, parsePositiveInt(values.get('months') ?? '6', '--months'));

  if (start >= end) throw new Error('--start must be before --end.');
  if (end.getTime() > Date.now() + 60_000) throw new Error('--end cannot be materially in the future.');

  const symbols = parseSymbols(values.get('symbol') ?? values.get('symbols'));
  return {
    symbols,
    start,
    end,
    dataDir: path.resolve(values.get('data-dir') ?? 'data'),
  };
}

function parseSymbols(raw: string | undefined): Symbol[] {
  const values = (raw ?? 'EURUSD')
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(values)];
  for (const symbol of unique) {
    if (!(ALL_SYMBOLS as readonly string[]).includes(symbol)) {
      throw new Error(`Unsupported symbol: ${symbol}`);
    }
  }
  return unique as Symbol[];
}

function parseDate(value: string, flag: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date for ${flag}: ${value}`);
  return date;
}

function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected positive integer for ${flag}.`);
  return parsed;
}

void main().catch(error => {
  console.error(`[HistoricalData] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
