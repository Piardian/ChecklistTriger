import * as fs from 'fs';
import * as path from 'path';
import { runHistoricalMarketReplay } from '../src/historicalMarketReplay';
import { StoredCandle } from './candleStore';
import { Symbol } from './universe';

process.env.ENABLE_TELEMETRY = 'false';

function parseArgs(): {
  symbol: Symbol;
  dataDir: string;
  start: number;
  end: number;
  outDir: string;
} {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      map.set(k, v);
    }
  }

  const symbol = (map.get('symbol') ?? 'BTCUSD') as Symbol;
  const dataDir = path.resolve(map.get('dataDir') ?? 'data/replay_1year');
  const start = Number(map.get('start') ?? 0);
  const end = Number(map.get('end') ?? Date.now());
  const outDir = path.resolve(map.get('outDir') ?? 'evidence/replay_3months');

  return { symbol, dataDir, start, end, outDir };
}

function readCandles(filePath: string): StoredCandle[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Candle file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function main(): void {
  const { symbol, dataDir, start, end, outDir } = parseArgs();
  console.log(`[Worker:${symbol}] Starting 3-month replay (${new Date(start).toISOString().split('T')[0]} to ${new Date(end).toISOString().split('T')[0]})...`);

  const file15m = path.join(dataDir, `${symbol}_15m.json`);
  const file1h = path.join(dataDir, `${symbol}_1h.json`);
  const file4h = path.join(dataDir, `${symbol}_4h.json`);

  const candles15m = readCandles(file15m);
  const candles1h = readCandles(file1h);
  const candles4h = readCandles(file4h);

  console.log(`[Worker:${symbol}] Loaded candles: 15m=${candles15m.length}, 1h=${candles1h.length}, 4h=${candles4h.length}`);

  const session = runHistoricalMarketReplay(
    {
      symbol,
      candles15m,
      candles1h,
      candles4h,
    },
    {
      startedTimestamp: start,
      finishedTimestamp: end,
      respectMarketWindow: true,
      respectKillzone: true,
      recordEvidence: false,
    }
  );

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${symbol}_session.json`);
  fs.writeFileSync(outFile, JSON.stringify(session, null, 2), 'utf8');

  console.log(
    `[Worker:${symbol}] COMPLETED: steps=${session.replayStepCount} candidates=${session.candidateCount} completedTrades=${session.completedOutcomeCount}`
  );
}

main();
