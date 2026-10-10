import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { HistoricalMarketReplaySession } from '../src/historicalMarketReplay';
import { universeCohort } from './universe';

process.env.ENABLE_TELEMETRY = 'false';
process.env.IS_REPLAY = 'true';

const SYMBOLS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'LTCUSD', 'EURUSD', 'GBPUSD', 'XAUUSD'] as const;
const DATA_DIR = path.resolve('data', 'replay_1year');
const OUT_DIR = path.resolve('evidence', 'replay_3months');

// Last 3 months: 2026-07-10 to 2026-10-10
const START_TS = new Date('2026-07-10T00:00:00.000Z').getTime();
const END_TS = new Date('2026-10-10T04:15:00.000Z').getTime();

async function runSymbol(symbol: string): Promise<HistoricalMarketReplaySession> {
  return new Promise((resolve, reject) => {
    const workerScript = path.resolve(__dirname, 'replaySymbolWorker.ts');
    const child = child_process.fork(
      workerScript,
      [
        `--symbol=${symbol}`,
        `--dataDir=${DATA_DIR}`,
        `--start=${START_TS}`,
        `--end=${END_TS}`,
        `--outDir=${OUT_DIR}`,
      ],
      {
        execArgv: ['-r', 'ts-node/register'],
        cwd: path.resolve(__dirname, '..'),
        stdio: 'pipe',
        env: {
          ...process.env,
          ENABLE_TELEMETRY: 'false',
          IS_REPLAY: 'true',
        },
      }
    );

    child.stdout?.on('data', data => {
      const line = data.toString().trim();
      if (line) console.log(line);
    });

    child.stderr?.on('data', data => {
      const line = data.toString().trim();
      if (line) console.error(`[Error:${symbol}] ${line}`);
    });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Worker for ${symbol} exited with code ${code}`));
      }
      try {
        const sessionFile = path.join(OUT_DIR, `${symbol}_session.json`);
        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        resolve(sessionData);
      } catch (err) {
        reject(err);
      }
    });

    child.on('error', err => {
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('================================================================');
  console.log(`[3MonthParallelReplay] Starting 3-month backtest across ${SYMBOLS.length} symbols in PARALLEL...`);
  console.log(`[3MonthParallelReplay] Window: 2026-07-10 to 2026-10-10 (8,850 15m bars / symbol)`);
  console.log(`[3MonthParallelReplay] Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`[3MonthParallelReplay] Parallel Cores: ${SYMBOLS.length} concurrent workers`);
  console.log('================================================================\n');

  const startTime = Date.now();

  const results = await Promise.allSettled(
    SYMBOLS.map(symbol => runSymbol(symbol))
  );

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n================================================================`);
  console.log(`[3MonthParallelReplay] All parallel workers finished in ${durationSec}s (${(durationSec / 60).toFixed(1)} mins)!`);
  console.log('================================================================\n');

  const summaryRows: any[] = [];
  let totalCandidates = 0;
  let totalTp = 0;
  let totalSl = 0;
  let totalExpired = 0;
  let totalUnresolved = 0;

  for (let i = 0; i < SYMBOLS.length; i++) {
    const symbol = SYMBOLS[i];
    const res = results[i];

    if (res.status === 'fulfilled') {
      const session = res.value;
      const trades = session.trades ?? [];
      const tp = trades.filter((t: any) => t.outcomeStatus === 'TAKE_PROFIT').length;
      const sl = trades.filter((t: any) => t.outcomeStatus === 'STOP_LOSS').length;
      const expired = trades.filter((t: any) => t.outcomeStatus === 'EXPIRED').length;
      const unresolved = trades.filter((t: any) => t.outcomeStatus === 'UNRESOLVED').length;
      const resolved = tp + sl;
      const wr = resolved > 0 ? ((tp / resolved) * 100).toFixed(1) + '%' : 'N/A';

      totalCandidates += trades.length;
      totalTp += tp;
      totalSl += sl;
      totalExpired += expired;
      totalUnresolved += unresolved;

      summaryRows.push({
        symbol,
        cohort: universeCohort(symbol as any),
        steps: session.replayStepCount,
        candidates: trades.length,
        takeProfit: tp,
        stopLoss: sl,
        expired,
        unresolved,
        winRate: wr,
      });
    } else {
      console.error(`[3MonthParallelReplay] Symbol ${symbol} failed:`, res.reason);
      summaryRows.push({
        symbol,
        cohort: universeCohort(symbol as any),
        error: String(res.reason),
      });
    }
  }

  const finalReport = {
    reportVersion: 1,
    timeframe: '3_MONTHS (2026-07-10 to 2026-10-10)',
    symbols: summaryRows,
    aggregate: {
      totalSymbols: SYMBOLS.length,
      totalCandidates,
      totalTakeProfit: totalTp,
      totalStopLoss: totalSl,
      totalExpired,
      totalUnresolved,
      resolvedWinRate: (totalTp + totalSl) > 0 ? ((totalTp / (totalTp + totalSl)) * 100).toFixed(1) + '%' : 'N/A',
      executionDurationSeconds: durationSec,
    },
  };

  const reportPath = path.join(OUT_DIR, 'historical-market-replay-3months-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2), 'utf8');

  console.log('================== 3-MONTH REPLAY SUMMARY ==================');
  console.table(summaryRows);
  console.log('AGGREGATE:', JSON.stringify(finalReport.aggregate, null, 2));
  console.log(`\nSaved master report to: ${reportPath}`);
}

main().catch(err => {
  console.error('[3MonthParallelReplay] Fatal error:', err);
  process.exit(1);
});
