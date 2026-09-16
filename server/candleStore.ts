import * as fs from 'fs';
import * as path from 'path';
import { Symbol } from './universe';
export type { Symbol } from './universe';

export type Timeframe = '1m' | '15m' | '1h' | '4h';

export interface StoredCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export class CandleStore {
  private dataDir: string;

  constructor(dataDir?: string) {
    const rawDir = dataDir ?? process.env.CANDLE_DATA_DIR ?? 'data';
    this.dataDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(process.cwd(), rawDir);
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getFilePath(symbol: Symbol, timeframe: Timeframe): string {
    return path.join(this.dataDir, `${symbol}_${timeframe}.json`);
  }

  getFileMtime(symbol: Symbol, timeframe: Timeframe): number | null {
    const filePath = this.getFilePath(symbol, timeframe);
    if (!fs.existsSync(filePath)) return null;
    try {
      return fs.statSync(filePath).mtimeMs;
    } catch {
      return null;
    }
  }

  isFresh(symbol: Symbol, timeframe: Timeframe, maxAgeMs: number, minCandles = 20): boolean {
    if (maxAgeMs <= 0) return false;
    const mtime = this.getFileMtime(symbol, timeframe);
    if (!mtime) return false;
    const now = Date.now();
    const age = Math.max(0, now - mtime);
    if (age >= maxAgeMs) return false;

    const candles = this.getCandles(symbol, timeframe);
    return candles.length >= minCandles;
  }

  appendCandle(symbol: Symbol, timeframe: Timeframe, candle: StoredCandle): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const filePath = this.getFilePath(symbol, timeframe);
    let candles = this.getCandles(symbol, timeframe);
    let appended = false;

    if (candles.length === 0) {
      candles.push(candle);
      appended = true;
    } else {
      const lastCandle = candles[candles.length - 1];
      if (candle.timestamp > lastCandle.timestamp) {
        candles.push(candle);
        appended = true;
      } else if (candle.timestamp === lastCandle.timestamp) {
        // Overwrite last candle. It may still be an updated market-data snapshot.
        candles[candles.length - 1] = candle;
        appended = true;
      } else {
        return;
      }
    }

    if (candles.length > 500) {
      candles = candles.slice(candles.length - 500);
    }

    const tempFilePath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
    try {
      fs.writeFileSync(tempFilePath, JSON.stringify(candles, null, 2), 'utf8');
      try {
        fs.renameSync(tempFilePath, filePath);
      } catch {
        fs.copyFileSync(tempFilePath, filePath);
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
    } catch {
      fs.writeFileSync(filePath, JSON.stringify(candles, null, 2), 'utf8');
    }

    // Dynamic import avoids a module cycle: outcomeTracker depends on pipeline types,
    // while CandleStore is imported by the live pipeline itself.
    if (appended && timeframe === '15m') {
      void this.processOutcomeTracking(symbol, candles);
    }
  }

  getCandles(symbol: Symbol, timeframe: Timeframe): StoredCandle[] {
    const filePath = this.getFilePath(symbol, timeframe);
    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content) as StoredCandle[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn(`[CandleStore] Failed to read ${filePath}:`, error);
      return [];
    }
  }

  private async processOutcomeTracking(symbol: Symbol, candles: readonly StoredCandle[]): Promise<void> {
    try {
      const { defaultMarketDataOutcomeTracker } = await import('../src/signalOutcomeTracker');
      const { appendCompletedSignalOutcomeEvidenceAsync } = await import('./evidenceRecorder');
      const results = defaultMarketDataOutcomeTracker.process(symbol, candles);

      for (const result of results) {
        if (result.status !== 'COMPLETED' || !result.outcome) continue;

        const signalId = result.outcome.signalId;
        appendCompletedSignalOutcomeEvidenceAsync({
          signalId,
          outcomeType: normalizeOutcomeType(result.outcome.outcomeType),
          holdingTimeMs: result.entryTriggeredAt === null
            ? null
            : Math.max(0, result.outcome.timestamp - result.entryTriggeredAt),
          rrAchieved: result.rrAchieved,
          maximumFavorableExcursion: result.maximumFavorableExcursion,
          maximumAdverseExcursion: result.maximumAdverseExcursion,
          exitTimestamp: result.outcome.timestamp,
          exitReason: result.outcome.reason.message,
        });

        console.log(
          `[OutcomeTracker] ${signalId} -> ${result.outcome.outcomeType}` +
          ` | RR=${result.rrAchieved ?? 'n/a'}` +
          ` | exit=${new Date(result.outcome.timestamp).toISOString()}`
        );
      }
    } catch (error) {
      console.warn(`[OutcomeTracker] Processing failed for ${symbol}:`, error);
    }
  }
}

function normalizeOutcomeType(
  outcomeType: 'WAITING_ENTRY' | 'ENTRY_TRIGGERED' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED' | 'CANCELLED' | 'MANUAL_CANCELLED' | 'UNKNOWN'
): 'TP' | 'SL' | 'BE' | 'MANUAL' | 'EXPIRED' | 'CANCELLED' | 'UNKNOWN' {
  switch (outcomeType) {
    case 'TAKE_PROFIT': return 'TP';
    case 'STOP_LOSS': return 'SL';
    case 'EXPIRED': return 'EXPIRED';
    case 'CANCELLED': return 'CANCELLED';
    case 'MANUAL_CANCELLED': return 'MANUAL';
    case 'UNKNOWN': return 'UNKNOWN';
    default: return 'UNKNOWN';
  }
}
