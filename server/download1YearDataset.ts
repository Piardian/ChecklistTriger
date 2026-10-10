import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

export interface StoredCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const CRYPTO_MAP: Record<string, string> = {
  BTCUSD: 'BTCUSDT',
  ETHUSD: 'ETHUSDT',
  SOLUSD: 'SOLUSDT',
  LTCUSD: 'LTCUSDT',
};

const FOREX_MAP: Record<string, string> = {
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  XAUUSD: 'XAU/USD',
};

const TWELVE_KEYS = [
  process.env.TWELVE_DATA_API_KEY,
  process.env.TWELVE_DATA_API_KEY_2,
  process.env.TWELVE_DATA_API_KEY_3,
  process.env.TWELVE_DATA_API_KEY_4,
  process.env.TWELVE_DATA_API_KEY_5,
].filter((k): k is string => Boolean(k && k.trim()));

let keyIndex = 0;
function getNextKey(): string {
  if (TWELVE_KEYS.length === 0) throw new Error('No Twelve Data API keys found in .env');
  const key = TWELVE_KEYS[keyIndex % TWELVE_KEYS.length];
  keyIndex++;
  return key;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchBinanceHistorical(
  spotSymbol: string,
  interval: string,
  startMs: number,
  endMs: number
): Promise<StoredCandle[]> {
  const candles: StoredCandle[] = [];
  let currentStart = startMs;

  while (currentStart < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${spotSymbol}&interval=${interval}&startTime=${currentStart}&endTime=${endMs}&limit=1000`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      console.warn(`[Binance] Network retry for ${spotSymbol} ${interval}:`, err);
      await sleep(1000);
      continue;
    }

    if (!res.ok) {
      console.warn(`[Binance] HTTP ${res.status} for ${spotSymbol} ${interval}`);
      await sleep(1000);
      continue;
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const item of data) {
      const raw = item as (number | string)[];
      candles.push({
        timestamp: Number(raw[0]),
        open: parseFloat(String(raw[1])),
        high: parseFloat(String(raw[2])),
        low: parseFloat(String(raw[3])),
        close: parseFloat(String(raw[4])),
      });
    }

    const lastBarTime = Number((data[data.length - 1] as (number | string)[])[0]);
    if (lastBarTime <= currentStart) break;
    currentStart = lastBarTime + 1;
    await sleep(80);
  }

  // Deduplicate and sort
  const map = new Map<number, StoredCandle>();
  for (const c of candles) map.set(c.timestamp, c);
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function mapTwelveInterval(timeframe: string): string {
  if (timeframe === '15m') return '15min';
  if (timeframe === '1m') return '1min';
  return timeframe;
}

async function fetchTwelveDataChunk(
  symbolMapped: string,
  interval: string,
  outputSize: number,
  endDate?: string
): Promise<StoredCandle[]> {
  const apiKey = getNextKey();
  const twelveInterval = mapTwelveInterval(interval);
  const params = new URLSearchParams({
    symbol: symbolMapped,
    interval: twelveInterval,
    outputsize: String(outputSize),
    apikey: apiKey,
    timezone: 'UTC',
  });
  if (endDate) params.set('end_date', endDate);

  const url = `https://api.twelvedata.com/time_series?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data: any = await res.json();
  if (data.status !== 'ok' || !Array.isArray(data.values)) {
    throw new Error(`Twelve Data error: ${data.message || JSON.stringify(data)}`);
  }

  const result: StoredCandle[] = [];
  for (const v of data.values) {
    const ts = new Date(v.datetime + 'Z').getTime();
    result.push({
      timestamp: ts,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    });
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchTwelveData1Year(
  symbolMapped: string,
  timeframe: '15m' | '1h' | '4h',
  startMs: number
): Promise<StoredCandle[]> {
  const candles: StoredCandle[] = [];
  const map = new Map<number, StoredCandle>();

  if (timeframe === '4h' || timeframe === '1h') {
    // 5000 candles for 4h is ~2.5 years, for 1h is ~7 months
    const chunk1 = await fetchTwelveDataChunk(symbolMapped, timeframe, 5000);
    chunk1.forEach(c => map.set(c.timestamp, c));
    await sleep(800);

    // If oldest candle is still newer than startMs, fetch previous chunk
    if (chunk1.length > 0 && chunk1[0].timestamp > startMs) {
      const oldestDate = new Date(chunk1[0].timestamp - 1000).toISOString().replace('T', ' ').slice(0, 19);
      try {
        const chunk2 = await fetchTwelveDataChunk(symbolMapped, timeframe, 5000, oldestDate);
        chunk2.forEach(c => map.set(c.timestamp, c));
      } catch (e) {
        console.warn(`[TwelveData] Could not fetch older chunk for ${symbolMapped} ${timeframe}:`, e);
      }
    }
  } else {
    // 15m: fetch in 5000-candle chunks until startMs
    let currentEndDate: string | undefined = undefined;
    for (let chunkIdx = 0; chunkIdx < 7; chunkIdx++) {
      const chunk = await fetchTwelveDataChunk(symbolMapped, '15m', 5000, currentEndDate);
      if (chunk.length === 0) break;
      chunk.forEach(c => map.set(c.timestamp, c));

      const oldest = chunk[0].timestamp;
      if (oldest <= startMs) break;

      currentEndDate = new Date(oldest - 1000).toISOString().replace('T', ' ').slice(0, 19);
      await sleep(1000);
    }
  }

  return Array.from(map.values())
    .filter(c => c.timestamp >= startMs)
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function main(): Promise<void> {
  const outDir = path.resolve('data', 'replay_1year');
  fs.mkdirSync(outDir, { recursive: true });

  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

  console.log(`[1YearDownloader] Storing 1-year historical dataset into ${outDir}`);
  console.log(`[1YearDownloader] Range: ${new Date(oneYearAgo).toISOString()} -> ${new Date(now).toISOString()}\n`);

  // 1. Download Crypto from Binance
  for (const [sym, spotSym] of Object.entries(CRYPTO_MAP)) {
    console.log(`[1YearDownloader] 🟡 Checking Crypto: ${sym} (${spotSym}) via Binance Spot...`);
    for (const tf of ['15m', '1h', '4h'] as const) {
      const filePath = path.join(outDir, `${sym}_${tf}.json`);
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 50_000) {
        console.log(`   -> ${sym} ${tf}: Already downloaded (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB), skipping.`);
        continue;
      }
      const candles = await fetchBinanceHistorical(spotSym, tf, oneYearAgo, now);
      fs.writeFileSync(filePath, JSON.stringify(candles, null, 2), 'utf8');
      console.log(`   -> ${sym} ${tf}: ${candles.length} bars saved (${new Date(candles[0].timestamp).toISOString().split('T')[0]} to ${new Date(candles[candles.length - 1].timestamp).toISOString().split('T')[0]})`);
    }
  }

  // 2. Download Forex & Gold from Twelve Data
  for (const [sym, mapped] of Object.entries(FOREX_MAP)) {
    console.log(`\n[1YearDownloader] 🌐 Checking Forex/Commodity: ${sym} (${mapped}) via Twelve Data...`);
    for (const tf of ['4h', '1h', '15m'] as const) {
      const filePath = path.join(outDir, `${sym}_${tf}.json`);
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 50_000) {
        console.log(`   -> ${sym} ${tf}: Already downloaded (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB), skipping.`);
        continue;
      }
      try {
        const candles = await fetchTwelveData1Year(mapped, tf, oneYearAgo);
        fs.writeFileSync(filePath, JSON.stringify(candles, null, 2), 'utf8');
        console.log(`   -> ${sym} ${tf}: ${candles.length} bars saved (${new Date(candles[0].timestamp).toISOString().split('T')[0]} to ${new Date(candles[candles.length - 1].timestamp).toISOString().split('T')[0]})`);
      } catch (err) {
        console.error(`   ❌ Error fetching ${sym} ${tf}:`, err);
      }
    }
  }

  console.log('\n[1YearDownloader] ✅ All 1-year historical datasets successfully downloaded!');
}

main().catch(err => {
  console.error('[1YearDownloader] Fatal error:', err);
  process.exit(1);
});
