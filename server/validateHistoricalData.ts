import * as fs from 'node:fs';
import * as path from 'node:path';
import { StoredCandle, Timeframe } from './candleStore';
import { ALL_SYMBOLS, Symbol } from './universe';

const TIMEFRAMES: readonly Timeframe[] = ['15m', '1h', '4h'];

async function main(): Promise<void> {
  const dataDir = path.resolve(process.env.REPLAY_DATA_DIR ?? 'data');
  const symbols = parseSymbols(process.env.REPLAY_SYMBOLS);

  let total = 0;
  for (const symbol of symbols) {
    for (const timeframe of TIMEFRAMES) {
      const file = path.join(dataDir, `${symbol}_${timeframe}.json`);
      const candles = readCandles(file);
      validateCandles(candles, timeframe, symbol);
      total += candles.length;
      console.log(`[HistoricalDataValidation] PASS ${symbol} ${timeframe}: ${candles.length} candles`);
    }
  }

  console.log(`[HistoricalDataValidation] PASS totalCandles=${total}`);
}

function readCandles(file: string): StoredCandle[] {
  if (!fs.existsSync(file)) throw new Error(`Missing candle file: ${file}`);
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`Candle file must contain an array: ${file}`);
  return parsed.map((value, index) => {
    if (!isStoredCandle(value)) throw new Error(`Invalid candle at index ${index}: ${file}`);
    return value;
  });
}

function validateCandles(candles: readonly StoredCandle[], timeframe: Timeframe, symbol: Symbol): void {
  if (candles.length === 0) throw new Error(`Empty dataset: ${symbol} ${timeframe}`);
  const intervalMs = timeframe === '15m' ? 15 * 60_000 : timeframe === '1h' ? 60 * 60_000 : 4 * 60 * 60_000;

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) throw new Error(`Non-positive price: ${symbol} ${timeframe} index=${i}`);
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) {
      throw new Error(`Invalid OHLC: ${symbol} ${timeframe} index=${i}`);
    }
    if (c.timestamp % intervalMs !== 0) throw new Error(`Misaligned timestamp: ${symbol} ${timeframe} index=${i}`);
    if (i > 0 && c.timestamp <= candles[i - 1].timestamp) throw new Error(`Non-monotonic timestamps: ${symbol} ${timeframe} index=${i}`);
  }
}

function isStoredCandle(value: unknown): value is StoredCandle {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return [c.timestamp, c.open, c.high, c.low, c.close].every(Number.isFinite);
}

function parseSymbols(raw: string | undefined): Symbol[] {
  const values = (raw ?? 'EURUSD').split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
  const unique = [...new Set(values)];
  for (const symbol of unique) {
    if (!(ALL_SYMBOLS as readonly string[]).includes(symbol)) throw new Error(`Unsupported symbol: ${symbol}`);
  }
  return unique as Symbol[];
}

void main().catch(error => {
  console.error(`[HistoricalDataValidation] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
