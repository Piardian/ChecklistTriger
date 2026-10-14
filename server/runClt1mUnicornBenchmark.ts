import * as fs from 'fs';
import * as path from 'path';
import { StoredCandle } from '../server/candleStore';
import { runPipeline, NotificationCandidate } from '../server/pipeline';
import { evaluateOutcome, OutcomeTrackerOptions, OutcomeTrackingResult } from '../src/signalOutcomeTracker';
import { evaluate1mUnicornSniperEntry, OneMinuteUnicornEvaluationResult } from '../src/entryMechanics';
import { evaluateKillzoneFilter } from '../server/killzone';
import { Candle } from '../src/types';
import { Symbol } from '../server/universe';

// Mock CandleStore implementation for replay
class ReplayCandleStore {
  private custom15m: StoredCandle[] = [];
  private custom1h: StoredCandle[] = [];
  private custom4h: StoredCandle[] = [];
  private custom1m: StoredCandle[] = [];

  setCandles(c15m: StoredCandle[], c1h: StoredCandle[], c4h: StoredCandle[], c1m: StoredCandle[]): void {
    this.custom15m = c15m;
    this.custom1h = c1h;
    this.custom4h = c4h;
    this.custom1m = c1m;
  }

  getCandles(_symbol: Symbol, timeframe: '15m' | '1h' | '4h' | '1m'): StoredCandle[] {
    if (timeframe === '15m') return this.custom15m;
    if (timeframe === '1h') return this.custom1h;
    if (timeframe === '4h') return this.custom4h;
    if (timeframe === '1m') return this.custom1m;
    return [];
  }
}

import { NotifiedStore } from '../server/notifiedStore';

class ReplayNotifiedStore extends NotifiedStore {
  private inMemoryKeys = new Set<string>();

  override hasBeenNotified(key: string): boolean {
    return this.inMemoryKeys.has(key);
  }

  override hasDurablyBeenNotified(key: string): boolean {
    return this.inMemoryKeys.has(key);
  }

  override markAsNotified(key: string): void {
    this.inMemoryKeys.add(key);
  }

  override hasImpulseOrNewerBeenNotified(symbol: string, breakTimestamp: number): boolean {
    const prefix = `${symbol}_15m_`;
    for (const key of this.inMemoryKeys) {
      if (key.startsWith(prefix)) {
        const parts = key.split('_');
        if (parts.length === 5) {
          const notifiedBreakTs = Number(parts[4]);
          if (Number.isFinite(notifiedBreakTs) && notifiedBreakTs >= breakTimestamp) {
            return true;
          }
        }
      }
    }
    return false;
  }

  override reservePending(keys: readonly string[]): boolean {
    for (const key of keys) {
      if (this.inMemoryKeys.has(key)) return false;
      this.inMemoryKeys.add(key);
    }
    return true;
  }
}

export async function runClt1mUnicornBenchmark() {
  console.log('\n' + '='.repeat(85));
  console.log('🌺 CLT (checklisttrigger / swing-bos-core) GERÇEK 1M UNICORN SNIPER TESTİ 🌺');
  console.log('   Mevcut SMC Motoru (runPipeline, Grade, Liquidity, Bias) HİÇ DEĞİŞTİRİLMEDİ.');
  console.log('   Giriş Mekanizması: 1M SFP (IDM Sweep) + iFVG + Breaker Block (Unicorn) & 0.5 Fib');
  console.log('   Karşılaştırma    : CLT 15M Standart Limit Modeli VS. 1M Unicorn Sniper Modeli');
  console.log('='.repeat(85) + '\n');

  const symbols: Symbol[] = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD'];

  let total15mSignals = 0;
  let total15mResolved = 0;
  let total15mUnresolved = 0;
  let total15mTp2 = 0;
  let total15mBe = 0;
  let total15mSl = 0;
  let total15mNetR = 0;

  let total1mFilled = 0;
  let total1mResolved = 0;
  let total1mTimeExit = 0;
  let total1mTp2 = 0;
  let total1mBe = 0;
  let total1mSl = 0;
  let total1mNetR = 0;
  let total1mVetoed = 0;

  for (const sym of symbols) {
    const file15m = path.resolve('data', `${sym}_15m.json`);
    const file1h = path.resolve('data', `${sym}_1h.json`);
    const file4h = path.resolve('data', `${sym}_4h.json`);
    const file1m = path.resolve('data', `${sym}_1m.json`);

    if (!fs.existsSync(file15m) || !fs.existsSync(file1h) || !fs.existsSync(file4h) || !fs.existsSync(file1m)) {
      continue;
    }

    const all15m: StoredCandle[] = JSON.parse(fs.readFileSync(file15m, 'utf8'));
    const all1h: StoredCandle[] = JSON.parse(fs.readFileSync(file1h, 'utf8'));
    const all4h: StoredCandle[] = JSON.parse(fs.readFileSync(file4h, 'utf8'));
    const all1m: StoredCandle[] = JSON.parse(fs.readFileSync(file1m, 'utf8'));

    const mockStore = new ReplayCandleStore();
    const notifiedStore = new ReplayNotifiedStore();

    for (let i = 40; i < all15m.length - 30; i++) {
      const current15m = all15m.slice(0, i + 1);
      const currentTime = current15m[current15m.length - 1].timestamp;

      const current1h = all1h.filter(c => c.timestamp <= currentTime);
      const current4h = all4h.filter(c => c.timestamp <= currentTime);
      const current1m = all1m.filter(c => c.timestamp <= currentTime);

      if (current1h.length < 15 || current4h.length < 15) continue;

      const kz = evaluateKillzoneFilter(new Date(currentTime));
      if (!kz.active) continue;

      mockStore.setCandles(current15m, current1h, current4h, current1m);

      // CLT Orijinal Pipeline (Hiç dokunulmadı!)
      const candidates = runPipeline(sym, mockStore as any, notifiedStore as any);

      for (const candidate of candidates) {
        if (notifiedStore.hasBeenNotified(candidate.uniqueKey)) continue;
        notifiedStore.markAsNotified(candidate.uniqueKey);
        if (candidate.dedupeKey) notifiedStore.markAsNotified(candidate.dedupeKey);

        total15mSignals += 1;

        // 1. Standart CLT 15M Outcome Değerlendirmesi
        const future15m = all15m.slice(i + 1) as unknown as Candle[];
        const outcome15m: OutcomeTrackingResult = evaluateOutcome(candidate, future15m, {
          entryWindowBars: 16,
          maxHoldBars: 48,
          entryMode: 'midpoint',
          targetRMultiple: 2.0,
          breakEvenTriggerR: 1.0,
        });

        let r15m = 0;
        let outcome15mStr = 'UNRESOLVED';
        if (outcome15m.outcome) {
          if (outcome15m.outcome.outcomeType === 'TAKE_PROFIT') {
            total15mTp2 += 1;
            r15m = 2.0;
            outcome15mStr = 'TP2 (+2.0R)';
          } else if (outcome15m.outcome.outcomeType === 'BREAK_EVEN') {
            total15mBe += 1;
            r15m = 0.5;
            outcome15mStr = 'BE (+0.5R)';
          } else if (outcome15m.outcome.outcomeType === 'STOP_LOSS') {
            total15mSl += 1;
            r15m = -1.0;
            outcome15mStr = 'SL (-1.0R)';
          }
          total15mNetR += r15m;
          total15mResolved += 1;
        } else {
          total15mUnresolved += 1;
        }

        // 2. Yeni Geliştirilen 1M UNICORN SNIPER Modeli Değerlendirmesi
        // Sinyal zamanından sonraki 1M barlarını filtrele
        const future1m = all1m.filter(c => c.timestamp >= currentTime) as unknown as Candle[];
        const zoneLow = candidate.poiType === 'OB' ? (candidate.poi as any).low : (candidate.poi as any).gapLow;
        const zoneHigh = candidate.poiType === 'OB' ? (candidate.poi as any).high : (candidate.poi as any).gapHigh;

        const m1Eval: OneMinuteUnicornEvaluationResult = evaluate1mUnicornSniperEntry({
          direction: candidate.tradeDirection,
          zoneLow,
          zoneHigh,
          symbol: sym,
          candles1m: future1m,
          maxWait1mBars: 90,
          requireFullUnicorn: false, // SFP + Breaker + iFVG
        });

        let outcome1mStr = 'VETO / NO_ENTRY';
        let r1m = 0;

        if (m1Eval.confirmed && m1Eval.filledBarIndex !== null) {
          total1mFilled += 1;
          const entryPrice = m1Eval.entryPrice!;
          const stopLoss = m1Eval.stopLoss!;
          const riskDistance = m1Eval.riskDistance!;
          const tp1Price = m1Eval.tp1Price!;
          const tp2Price = m1Eval.tp2Price!;
          const isLong = candidate.tradeDirection === 'long';

          let tp1Hit = false;
          let m1Closed = false;

          const execution1mBars = future1m.slice(m1Eval.filledBarIndex + 1);
          for (const bar of execution1mBars) {
            if (!tp1Hit) {
              const slHit = isLong ? bar.low <= stopLoss : bar.high >= stopLoss;
              const tp1Reached = isLong ? bar.high >= tp1Price : bar.low <= tp1Price;

              if (slHit) {
                total1mSl += 1;
                r1m = -1.0;
                outcome1mStr = 'SL (-1.0R)';
                m1Closed = true;
                break;
              }
              if (tp1Reached) {
                tp1Hit = true;
              }
            } else {
              // BE Stop
              const beHit = isLong ? bar.low <= entryPrice : bar.high >= entryPrice;
              const tp2Reached = isLong ? bar.high >= tp2Price : bar.low <= tp2Price;

              if (tp2Reached) {
                total1mTp2 += 1;
                r1m = 2.0;
                outcome1mStr = '🎯 TP2 (+2.0R)';
                m1Closed = true;
                break;
              }
              if (beHit) {
                total1mBe += 1;
                r1m = 0.5;
                outcome1mStr = '🛡️ BE (+0.5R)';
                m1Closed = true;
                break;
              }
            }
          }

          if (!m1Closed) {
            if (tp1Hit) {
              total1mBe += 1;
              r1m = 0.5;
              outcome1mStr = '🛡️ BE (+0.5R)';
            } else {
              outcome1mStr = 'TIME_EXIT (+0.0R)';
              total1mTimeExit += 1;
            }
          }
          total1mNetR += r1m;
          total1mResolved += 1;
        } else {
          total1mVetoed += 1;
          outcome1mStr = `⛔ ${m1Eval.reason}`;
        }

        const dateStr = new Date(currentTime).toISOString().replace('T', ' ').slice(0, 16);
        console.log(
          `${dateStr} | ${sym.padEnd(7)} ${candidate.tradeDirection.toUpperCase().padEnd(5)} | ` +
          `Grade: ${candidate.gradeResult.grade} | ` +
          `15M CLT: ${outcome15mStr.padEnd(12)} -> 1M Sniper: ${outcome1mStr}`
        );
      }
    }
  }

  console.log('\n' + '='.repeat(85));
  console.log('🏆 CLT (checklisttrigger) 15M VS. 1M UNICORN SNIPER SONUÇLARI:');
  console.log('-'.repeat(85));
  console.log('1) CLT 15M STANDART MODELİ (Mevcut SMC Motoru):');
  console.log(`   Toplam Sinyal  : ${total15mSignals}`);
  console.log(`   TP2 (+2.0R)    : ${total15mTp2}`);
  console.log(`   BE  (+0.5R)    : ${total15mBe}`);
  console.log(`   SL  (-1.0R)    : ${total15mSl}`);
  console.log(`   Resolved       : ${total15mResolved} | Unresolved: ${total15mUnresolved}`);
  const wr15m = total15mResolved > 0 ? ((total15mTp2 + total15mBe) / total15mResolved * 100).toFixed(1) : 'N/A';
  console.log(`   Resolved Win Rate: ${wr15m === 'N/A' ? wr15m : `%${wr15m}`}`);
  console.log(`   Net R Getirisi : ${total15mNetR >= 0 ? '+' : ''}${total15mNetR.toFixed(1)} R`);
  console.log('-'.repeat(85));
  console.log('2) CLT 1M UNICORN SNIPER MODELİ (Entegre Edilen Yeni Mekanizma):');
  console.log(`   1M İcrasına Dolan: ${total1mFilled} (Onay vermeyen / delinen ${total1mVetoed} işlem elendi)`);
  console.log(`   🎯 Tam TP2     : ${total1mTp2} adet (+2.0R)`);
  console.log(`   🛡️ TP1 + BE    : ${total1mBe} adet (+0.5R)`);
  console.log(`   🛑 Stop Loss   : ${total1mSl} adet (-1.0R)`);
  console.log(`   Resolved       : ${total1mResolved} | Time exits: ${total1mTimeExit}`);
  const wr1m = total1mResolved > 0 ? ((total1mTp2 + total1mBe) / total1mResolved * 100).toFixed(1) : 'N/A';
  console.log(`   Resolved Win Rate: ${wr1m === 'N/A' ? wr1m : `%${wr1m}`}`);
  console.log(`   Net R Getirisi : ${total1mNetR >= 0 ? '+' : ''}${total1mNetR.toFixed(1)} R`);
  console.log('='.repeat(85) + '\n');
}

runClt1mUnicornBenchmark().catch(console.error);
