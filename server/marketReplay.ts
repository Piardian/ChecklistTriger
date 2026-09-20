import * as fs from 'fs';
import * as path from 'path';
import { CandleStore, StoredCandle } from './candleStore';
import { NotifiedStore } from './notifiedStore';
import { runPipeline, NotificationCandidate } from './pipeline';
import { evaluateOutcome, OutcomeTrackingResult, OutcomeTrackerOptions } from '../src/signalOutcomeTracker';
import { createSignalContext } from '../src/signalContext';
import { evaluateKillzoneFilter } from './killzone';
import { Candle } from '../src/types';
import { Symbol } from './universe';

class MockCandleStore extends CandleStore {
  private custom15m: StoredCandle[] = [];
  private custom1h: StoredCandle[] = [];
  private custom4h: StoredCandle[] = [];

  setCandles(c15m: StoredCandle[], c1h: StoredCandle[], c4h: StoredCandle[]): void {
    this.custom15m = c15m;
    this.custom1h = c1h;
    this.custom4h = c4h;
  }

  override getCandles(symbol: Symbol, timeframe: '15m' | '1h' | '4h' | '1m'): StoredCandle[] {
    if (timeframe === '15m') return this.custom15m;
    if (timeframe === '1h') return this.custom1h;
    if (timeframe === '4h') return this.custom4h;
    return [];
  }
}

class InMemoryNotifiedStore extends NotifiedStore {
  private keys = new Set<string>();

  override hasBeenNotified(key: string): boolean {
    return this.keys.has(key);
  }

  override markAsNotified(key: string): void {
    this.keys.add(key);
  }

  override reservePending(keys: readonly string[]): boolean {
    for (const key of keys) {
      if (this.keys.has(key)) return false;
      this.keys.add(key);
    }
    return true;
  }
}

export interface ReplaySignalRecord {
  signalId: string;
  symbol: string;
  direction: 'long' | 'short';
  poiType: 'OB' | 'FVG';
  grade: string;
  score: number;
  barIndex: number;
  signalTimestamp: string;
  observationTimestamp: string;
  evaluationStartTimestamp: string | null;
  evaluationEndTimestamp: string | null;
  evaluatedCandleCount: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  riskDistance: number;
  outcomeStatus: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED' | 'UNRESOLVED';
  entryTriggeredAt: string | null;
  exitTimestamp: string | null;
  exitReason: string;
  rrAchieved: number | null;
  holdingBars: number;
  maximumFavorableExcursion: number | null;
  maximumAdverseExcursion: number | null;
}

export interface JournalMatch {
  journalTradeId: number;
  journalTimestamp: string;
  journalDirection: string;
  journalGrade: string;
  journalOutcome: string;
  matchedSignalId: string | null;
  matchStatus: 'EXACT_MATCH' | 'CLOSE_MATCH' | 'NOT_FOUND_IN_REPLAY';
  replayOutcomeStatus: string | null;
  notes: string;
}

export interface MarketReplayExecutionOptions {
  symbol?: string;
  entryWindowBars?: number;
  maxHoldBars?: number;
  entryMode?: 'midpoint' | 'zone_touch';
  targetRMultiple?: number;
  startedTimestamp?: number;
  finishedTimestamp?: number;
  applyKillzone?: boolean;
}

export interface ComprehensiveReplayReport {
  generatedAt: string;
  configuration: {
    symbol: string;
    applyKillzoneFilter: boolean;
    minWarmUpBars: number;
    entryWindowBars: number;
    maxHoldBars: number;
    entryMode: 'midpoint' | 'zone_touch';
    targetRMultiple: number;
    startedTimestamp?: number;
    finishedTimestamp?: number;
  };
  period: {
    startedAt: string;
    finishedAt: string;
    total15mBars: number;
    evaluated15mBars: number;
    killzoneSkippedBars: number;
  };
  signalStatistics: {
    totalSignalsGenerated: number;
    longCount: number;
    shortCount: number;
    gradeDistribution: Record<string, number>;
    duplicatePoiPrevented: number;
  };
  outcomes: {
    takeProfit: number;
    stopLoss: number;
    expired: number;
    unresolved: number;
    winRate: string;
    totalRealizedR: number;
    averageRealizedR: number;
    averageHoldingBars: number;
    averageMfe: number;
    averageMae: number;
  };
  journalMatches: JournalMatch[];
  signals: ReplaySignalRecord[];
}

export function runMarketReplay(options: MarketReplayExecutionOptions = {}): ComprehensiveReplayReport {
  const targetSymbol = options.symbol ?? process.env.REPLAY_SYMBOL ?? 'EURUSD';
  const applyKillzone = options.applyKillzone ?? (process.env.REPLAY_APPLY_KILLZONE === 'true');
  const entryWindowBars = options.entryWindowBars ?? (process.env.REPLAY_ENTRY_WINDOW_BARS ? parseInt(process.env.REPLAY_ENTRY_WINDOW_BARS, 10) : 16);
  const maxHoldBars = options.maxHoldBars ?? (process.env.REPLAY_MAX_HOLD_BARS ? parseInt(process.env.REPLAY_MAX_HOLD_BARS, 10) : 32);
  const entryMode = options.entryMode ?? ((process.env.REPLAY_ENTRY_MODE as any) ?? 'midpoint');
  const targetRMultiple = options.targetRMultiple ?? (process.env.REPLAY_TARGET_R ? parseFloat(process.env.REPLAY_TARGET_R) : 2);
  const startedTimestamp = options.startedTimestamp ?? (process.env.REPLAY_STARTED_TIMESTAMP ? parseTimestamp(process.env.REPLAY_STARTED_TIMESTAMP) : undefined);
  const finishedTimestamp = options.finishedTimestamp ?? (process.env.REPLAY_FINISHED_TIMESTAMP ? parseTimestamp(process.env.REPLAY_FINISHED_TIMESTAMP) : undefined);

  const hist15m = path.resolve('data', 'historical', `${targetSymbol}_15m.json`);
  const file15m = fs.existsSync(hist15m) ? hist15m : path.resolve('data', `${targetSymbol}_15m.json`);
  const hist1h = path.resolve('data', 'historical', `${targetSymbol}_1h.json`);
  const file1h = fs.existsSync(hist1h) ? hist1h : path.resolve('data', `${targetSymbol}_1h.json`);
  const hist4h = path.resolve('data', 'historical', `${targetSymbol}_4h.json`);
  const file4h = fs.existsSync(hist4h) ? hist4h : path.resolve('data', `${targetSymbol}_4h.json`);

  if (!fs.existsSync(file15m) || !fs.existsSync(file1h) || !fs.existsSync(file4h)) {
    throw new Error(`Candle files missing for ${targetSymbol}`);
  }

  const all15m: StoredCandle[] = JSON.parse(fs.readFileSync(file15m, 'utf8'));
  const all1h: StoredCandle[] = JSON.parse(fs.readFileSync(file1h, 'utf8'));
  const all4h: StoredCandle[] = JSON.parse(fs.readFileSync(file4h, 'utf8'));

  const mockStore = new MockCandleStore();
  const notifiedStore = new InMemoryNotifiedStore();
  const signals: ReplaySignalRecord[] = [];

  let evaluatedBars = 0;
  let killzoneSkippedBars = 0;
  let duplicatePoiPrevented = 0;
  const minWarmUpBars = 30;

  for (let i = minWarmUpBars; i < all15m.length; i++) {
    const current15m = all15m.slice(0, i + 1);
    const currentCandle = current15m[current15m.length - 1];
    const currentTime = currentCandle.timestamp;

    if (startedTimestamp && currentTime < startedTimestamp) continue;
    if (finishedTimestamp && currentTime > finishedTimestamp) break;

    const current1h = all1h.filter(c => c.timestamp <= currentTime);
    const current4h = all4h.filter(c => c.timestamp <= currentTime);

    if (current1h.length < 15 || current4h.length < 15) {
      continue;
    }

    if (applyKillzone) {
      const kz = evaluateKillzoneFilter(new Date(currentTime));
      if (!kz.active) {
        killzoneSkippedBars += 1;
        continue;
      }
    }

    evaluatedBars += 1;
    mockStore.setCandles(current15m, current1h, current4h);

    const candidates = runPipeline(targetSymbol as Symbol, mockStore, notifiedStore);

    for (const candidate of candidates) {
      if (notifiedStore.hasBeenNotified(candidate.uniqueKey) ||
          (candidate.dedupeKey && notifiedStore.hasBeenNotified(candidate.dedupeKey))) {
        duplicatePoiPrevented += 1;
        continue;
      }

      notifiedStore.markAsNotified(candidate.uniqueKey);
      if (candidate.dedupeKey) {
        notifiedStore.markAsNotified(candidate.dedupeKey);
      }

      if (!candidate.signalContext) {
        candidate.signalContext = createSignalContext({
          signalId: candidate.signalId ?? candidate.uniqueKey,
          pair: candidate.symbol,
          direction: candidate.tradeDirection,
          timeframe: '15m',
          grade: candidate.gradeResult.grade,
          score: candidate.gradeResult.totalScore,
          executionStatus: 'EXECUTION_READY',
          riskStatus: 'NO_RISK',
          timestamp: candidate.poi.relatedEvent.breakTimestamp,
          lifecycleStates: ['DETECTED', 'GRADED', 'EXECUTION_READY'],
        });
      }

      const futureCandles = all15m.slice(i + 1) as unknown as Candle[];
      const trackerOptions: OutcomeTrackerOptions = {
        entryWindowBars,
        maxHoldBars,
        entryMode,
        targetRMultiple,
      };

      const outcomeResult: OutcomeTrackingResult = evaluateOutcome(candidate, futureCandles, trackerOptions);

      let outcomeStatus: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED' | 'UNRESOLVED' = 'UNRESOLVED';
      let exitReason = outcomeResult.status === 'OPEN'
        ? 'STILL_OPEN_AT_END_OF_DATASET'
        : 'WAITING_ENTRY_AT_END_OF_DATASET';
      let exitTimestamp: string | null = null;
      let holdingBars = 0;

      if (outcomeResult.status === 'COMPLETED' && outcomeResult.outcome) {
        const type = outcomeResult.outcome.outcomeType;
        if (type === 'TAKE_PROFIT' || type === 'STOP_LOSS' || type === 'EXPIRED') {
          outcomeStatus = type;
        }
        exitReason = outcomeResult.outcome.reason.code;
        exitTimestamp = new Date(outcomeResult.outcome.timestamp).toISOString();

        if (outcomeResult.entryTriggeredAt && outcomeResult.outcome) {
          const entryIdx = futureCandles.findIndex(c => c.timestamp === outcomeResult.entryTriggeredAt);
          const exitIdx = futureCandles.findIndex(c => c.timestamp === outcomeResult.outcome!.timestamp);
          if (entryIdx >= 0 && exitIdx >= entryIdx) {
            holdingBars = exitIdx - entryIdx;
          } else {
            holdingBars = Math.max(1, Math.round((outcomeResult.outcome.timestamp - outcomeResult.entryTriggeredAt) / (15 * 60 * 1000)));
          }
        } else {
          holdingBars = outcomeResult.evaluation?.evaluatedCandles ?? entryWindowBars;
        }
      }

      const evaluationStartTs = outcomeResult.evaluation?.evaluationStartTimestamp
        ? new Date(outcomeResult.evaluation.evaluationStartTimestamp).toISOString()
        : new Date(currentTime).toISOString();
      const evaluationEndTs = outcomeResult.evaluation?.evaluationEndTimestamp
        ? new Date(outcomeResult.evaluation.evaluationEndTimestamp).toISOString()
        : exitTimestamp;
      const evaluatedCandleCount = outcomeResult.evaluation?.evaluatedCandles ?? holdingBars;

      signals.push({
        signalId: candidate.signalId ?? candidate.uniqueKey,
        symbol: candidate.symbol,
        direction: candidate.tradeDirection,
        poiType: candidate.poiType,
        grade: candidate.gradeResult.grade,
        score: candidate.gradeResult.totalScore,
        barIndex: i,
        signalTimestamp: new Date(currentTime).toISOString(),
        observationTimestamp: new Date(currentTime).toISOString(),
        evaluationStartTimestamp: evaluationStartTs,
        evaluationEndTimestamp: evaluationEndTs,
        evaluatedCandleCount,
        entryPrice: outcomeResult.plan.entryPrice,
        stopPrice: outcomeResult.plan.stopPrice,
        targetPrice: outcomeResult.plan.targetPrice,
        riskDistance: outcomeResult.plan.riskDistance,
        outcomeStatus,
        entryTriggeredAt: outcomeResult.entryTriggeredAt ? new Date(outcomeResult.entryTriggeredAt).toISOString() : null,
        exitTimestamp,
        exitReason,
        rrAchieved: outcomeResult.rrAchieved,
        holdingBars,
        maximumFavorableExcursion: outcomeResult.maximumFavorableExcursion,
        maximumAdverseExcursion: outcomeResult.maximumAdverseExcursion,
      });
    }
  }

  const takeProfit = signals.filter(s => s.outcomeStatus === 'TAKE_PROFIT').length;
  const stopLoss = signals.filter(s => s.outcomeStatus === 'STOP_LOSS').length;
  const expired = signals.filter(s => s.outcomeStatus === 'EXPIRED').length;
  const unresolved = signals.filter(s => s.outcomeStatus === 'UNRESOLVED').length;
  const terminalResolved = takeProfit + stopLoss;
  const winRate = terminalResolved > 0
    ? `${((takeProfit / terminalResolved) * 100).toFixed(1)}%`
    : 'N/A';

  const longCount = signals.filter(s => s.direction === 'long').length;
  const shortCount = signals.filter(s => s.direction === 'short').length;

  const gradeDistribution: Record<string, number> = {};
  for (const s of signals) {
    gradeDistribution[s.grade] = (gradeDistribution[s.grade] ?? 0) + 1;
  }

  let totalRealizedR = 0;
  let resolvedRCount = 0;
  let totalHoldingBars = 0;
  let totalMfe = 0;
  let totalMae = 0;

  for (const s of signals) {
    if (s.outcomeStatus === 'TAKE_PROFIT') {
      totalRealizedR += targetRMultiple;
      resolvedRCount += 1;
    } else if (s.outcomeStatus === 'STOP_LOSS') {
      totalRealizedR -= 1;
      resolvedRCount += 1;
    }
    if (s.holdingBars > 0) totalHoldingBars += s.holdingBars;
    if (s.maximumFavorableExcursion) totalMfe += s.maximumFavorableExcursion;
    if (s.maximumAdverseExcursion) totalMae += s.maximumAdverseExcursion;
  }

  const averageRealizedR = resolvedRCount > 0 ? Number((totalRealizedR / resolvedRCount).toFixed(2)) : 0;
  const averageHoldingBars = signals.length > 0 ? Number((totalHoldingBars / signals.length).toFixed(1)) : 0;
  const averageMfe = signals.length > 0 ? Number((totalMfe / signals.length).toFixed(5)) : 0;
  const averageMae = signals.length > 0 ? Number((totalMae / signals.length).toFixed(5)) : 0;

  // Known EURUSD live journal trades
  const journalMatches: JournalMatch[] = [];
  if (targetSymbol === 'EURUSD') {
    const knownTrades = [
      { id: 10, time: '2026-08-31T07:00:00.000Z', dir: 'short', grade: 'Grade A', outcome: 'TP' },
      { id: 34, time: '2026-09-02T20:15:00.000Z', dir: 'long', grade: 'Grade A', outcome: 'STOP' },
    ];

    for (const kt of knownTrades) {
      const match = signals.find(s => {
        const diffMs = Math.abs(new Date(s.signalTimestamp).getTime() - new Date(kt.time).getTime());
        return diffMs <= 48 * 60 * 60 * 1000 && s.direction === kt.dir;
      });

      if (match) {
        journalMatches.push({
          journalTradeId: kt.id,
          journalTimestamp: kt.time,
          journalDirection: kt.dir,
          journalGrade: kt.grade,
          journalOutcome: kt.outcome,
          matchedSignalId: match.signalId,
          matchStatus: match.signalTimestamp === kt.time ? 'EXACT_MATCH' : 'CLOSE_MATCH',
          replayOutcomeStatus: match.outcomeStatus,
          notes: `Replay timestamp: ${match.signalTimestamp}, Exit: ${match.exitTimestamp} (${match.exitReason})`,
        });
      } else {
        journalMatches.push({
          journalTradeId: kt.id,
          journalTimestamp: kt.time,
          journalDirection: kt.dir,
          journalGrade: kt.grade,
          journalOutcome: kt.outcome,
          matchedSignalId: null,
          matchStatus: 'NOT_FOUND_IN_REPLAY',
          replayOutcomeStatus: null,
          notes: 'Signal not produced by raw pipeline; likely required manual trigger or earlier formation',
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    configuration: {
      symbol: targetSymbol,
      applyKillzoneFilter: applyKillzone,
      minWarmUpBars,
      entryWindowBars,
      maxHoldBars,
      entryMode,
      targetRMultiple,
      startedTimestamp,
      finishedTimestamp,
    },
    period: {
      startedAt: new Date(all15m[0].timestamp).toISOString(),
      finishedAt: new Date(all15m[all15m.length - 1].timestamp).toISOString(),
      total15mBars: all15m.length,
      evaluated15mBars: evaluatedBars,
      killzoneSkippedBars,
    },
    signalStatistics: {
      totalSignalsGenerated: signals.length,
      longCount,
      shortCount,
      gradeDistribution,
      duplicatePoiPrevented,
    },
    outcomes: {
      takeProfit,
      stopLoss,
      expired,
      unresolved,
      winRate,
      totalRealizedR,
      averageRealizedR,
      averageHoldingBars,
      averageMfe,
      averageMae,
    },
    journalMatches,
    signals,
  };
}

function parseTimestamp(val: string): number {
  const n = Number(val);
  if (!Number.isNaN(n) && n > 0) return n;
  return new Date(val).getTime();
}

function parseArgs(): MarketReplayExecutionOptions & { outputFile?: string } {
  const args = process.argv.slice(2);
  const options: MarketReplayExecutionOptions & { outputFile?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--symbol' && args[i + 1]) {
      options.symbol = args[++i];
    } else if (arg === '--entry-window' && args[i + 1]) {
      options.entryWindowBars = parseInt(args[++i], 10);
    } else if (arg === '--max-hold' && args[i + 1]) {
      options.maxHoldBars = parseInt(args[++i], 10);
    } else if (arg === '--entry-mode' && args[i + 1]) {
      options.entryMode = args[++i] as any;
    } else if (arg === '--target-r' && args[i + 1]) {
      options.targetRMultiple = parseFloat(args[++i]);
    } else if (arg === '--start' && args[i + 1]) {
      options.startedTimestamp = parseTimestamp(args[++i]);
    } else if (arg === '--end' && args[i + 1]) {
      options.finishedTimestamp = parseTimestamp(args[++i]);
    } else if (arg === '--killzone') {
      options.applyKillzone = true;
    } else if (arg === '--output' && args[i + 1]) {
      options.outputFile = args[++i];
    } else if (!arg.startsWith('--') && !options.symbol) {
      options.symbol = arg;
    }
  }

  return options;
}

function main(): void {
  const parsed = parseArgs();
  const symbol = parsed.symbol || process.env.REPLAY_SYMBOL || 'EURUSD';
  const outputFile = path.resolve(
    parsed.outputFile || process.env.REPLAY_REPORT_FILE || 'evidence/replay/historical-market-replay-report.json'
  );

  console.log('================================================================');
  console.log(`[MarketReplay] Running Full Historical Market Replay for ${symbol}`);
  console.log(`[Configuration] EntryWindow: ${parsed.entryWindowBars ?? 16} bars | EntryMode: ${parsed.entryMode ?? 'midpoint'} | MaxHold: ${parsed.maxHoldBars ?? 32} bars | Target: ${parsed.targetRMultiple ?? 2}R`);
  console.log('================================================================');

  const report = runMarketReplay(parsed);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf8');

  console.log(`[Period] ${report.period.startedAt} -> ${report.period.finishedAt}`);
  console.log(`[Bars] Total 15M: ${report.period.total15mBars} | Evaluated: ${report.period.evaluated15mBars} | Killzone Skipped: ${report.period.killzoneSkippedBars}`);
  console.log(`[Signals] Generated: ${report.signalStatistics.totalSignalsGenerated} (Long: ${report.signalStatistics.longCount}, Short: ${report.signalStatistics.shortCount})`);
  console.log(`[Grades] ${JSON.stringify(report.signalStatistics.gradeDistribution)}`);
  console.log(`[Deduped Duplicates Prevented] ${report.signalStatistics.duplicatePoiPrevented}`);
  console.log('----------------------------------------------------------------');
  console.log(`[Outcomes]`);
  console.log(`  🎯 TAKE_PROFIT : ${report.outcomes.takeProfit}`);
  console.log(`  ❌ STOP_LOSS   : ${report.outcomes.stopLoss}`);
  console.log(`  ⏳ EXPIRED     : ${report.outcomes.expired}`);
  console.log(`  🔄 UNRESOLVED   : ${report.outcomes.unresolved}`);
  console.log(`  📊 Win Rate    : ${report.outcomes.winRate}`);
  console.log(`  💰 Realized R  : Total ${report.outcomes.totalRealizedR}R (Avg: ${report.outcomes.averageRealizedR}R)`);
  console.log(`  ⏱️ Avg Holding : ${report.outcomes.averageHoldingBars} bars (~${(report.outcomes.averageHoldingBars * 0.25).toFixed(1)} hours)`);
  console.log(`  📈 Avg MFE/MAE : MFE=${report.outcomes.averageMfe} | MAE=${report.outcomes.averageMae}`);
  console.log('----------------------------------------------------------------');

  if (report.journalMatches.length > 0) {
    console.log(`[SMC Journal Correlation] (${report.journalMatches.length} entries matched):`);
    for (const jm of report.journalMatches) {
      console.log(`  #${jm.journalTradeId} [${jm.journalTimestamp}] ${jm.journalDirection.toUpperCase()} | Journal: ${jm.journalOutcome} | Replay: ${jm.replayOutcomeStatus ?? 'NO_MATCH'} (${jm.matchStatus})`);
      if (jm.notes) console.log(`     -> ${jm.notes}`);
    }
    console.log('----------------------------------------------------------------');
  }

  if (report.signals.length > 0) {
    console.log(`[Generated Signals Details]:`);
    for (const s of report.signals) {
      console.log(`  • [${s.signalTimestamp}] ${s.direction.toUpperCase()} ${s.poiType} (Grade ${s.grade}, Score ${s.score})`);
      console.log(`    Entry: ${s.entryPrice} | Stop: ${s.stopPrice} | Target: ${s.targetPrice}`);
      console.log(`    Status: ${s.outcomeStatus} (${s.exitReason}) | R: ${s.rrAchieved ?? 'N/A'} | Triggered: ${s.entryTriggeredAt ?? 'NO'} | Exit: ${s.exitTimestamp ?? 'N/A'}`);
    }
  }

  console.log(`\n[MarketReplay] Full report saved to: ${outputFile}`);
  console.log('================================================================\n');
}

if (require.main === module) {
  main();
}
