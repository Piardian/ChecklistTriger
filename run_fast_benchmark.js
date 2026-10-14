const fs = require('fs');
const path = require('path');
const { runPipeline } = require('./dist/server/pipeline');
const { evaluateOutcome } = require('./dist/src/signalOutcomeTracker');
const { evaluate1mUnicornSniperEntry } = require('./dist/src/entryMechanics');
const { evaluateKillzoneFilter } = require('./dist/server/killzone');

class FastCandleStore {
  constructor() {
    this.c15m = [];
    this.c1h = [];
    this.c4h = [];
    this.c1m = [];
  }
  set(c15m, c1h, c4h, c1m) {
    this.c15m = c15m;
    this.c1h = c1h;
    this.c4h = c4h;
    this.c1m = c1m;
  }
  getCandles(_s, tf) {
    if (tf === '15m') return this.c15m;
    if (tf === '1h') return this.c1h;
    if (tf === '4h') return this.c4h;
    if (tf === '1m') return this.c1m;
    return [];
  }
}

class FastNotifiedStore {
  constructor() {
    this.keys = new Set();
  }
  hasBeenNotified(k) { return this.keys.has(k); }
  hasDurablyBeenNotified(k) { return this.keys.has(k); }
  markAsNotified(k) { this.keys.add(k); }
  reservePending(arr) {
    for (const k of arr) {
      if (this.keys.has(k)) return false;
      this.keys.add(k);
    }
    return true;
  }
  hasImpulseOrNewerBeenNotified(sym, breakTs) {
    const prefix = `${sym}_15m_`;
    for (const k of this.keys) {
      if (k.startsWith(prefix)) {
        const parts = k.split('_');
        if (parts.length === 5) {
          const nTs = Number(parts[4]);
          if (Number.isFinite(nTs) && nTs >= breakTs) return true;
        }
      }
    }
    return false;
  }
}

function runFastCltBenchmark() {
  console.log('\n' + '='.repeat(85));
  console.log('🌺 CLT (checklisttrigger / swing-bos-core) 1M UNICORN SNIPER HIZLI TEST 🌺');
  console.log('   Mevcut SMC Motoru (runPipeline, Grade, Liquidity, Bias) BİREBİR KORUNDU.');
  console.log('   Giriş Mekanizması: 1M SFP (IDM Sweep) + iFVG + Breaker Block (Unicorn) & 0.5 Fib');
  console.log('   Periyot: 2026-09-11 ile 2026-10-11 (1 Ay)');
  console.log('='.repeat(85) + '\n');

  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'SOLUSD'];

  let total15m = 0, tp2_15m = 0, be_15m = 0, sl_15m = 0, netR_15m = 0;
  let total1m = 0, tp2_1m = 0, be_1m = 0, sl_1m = 0, netR_1m = 0, veto1m = 0;

  const results = [];

  for (const sym of symbols) {
    const f15 = path.resolve('data', `${sym}_15m.json`);
    const f1h = path.resolve('data', `${sym}_1h.json`);
    const f4h = path.resolve('data', `${sym}_4h.json`);
    const f1m = path.resolve('data', `${sym}_1m.json`);

    if (!fs.existsSync(f15) || !fs.existsSync(f1h) || !fs.existsSync(f4h) || !fs.existsSync(f1m)) {
      continue;
    }

    const all15m = JSON.parse(fs.readFileSync(f15, 'utf8'));
    const all1h = JSON.parse(fs.readFileSync(f1h, 'utf8'));
    const all4h = JSON.parse(fs.readFileSync(f4h, 'utf8'));
    const all1m = JSON.parse(fs.readFileSync(f1m, 'utf8'));

    const store = new FastCandleStore();
    const notified = new FastNotifiedStore();

    // 15M barlarında ilerle
    for (let i = 30; i < all15m.length - 15; i++) {
      const c15 = all15m.slice(0, i + 1);
      const curTime = c15[c15.length - 1].timestamp;

      // Killzone kontrolü
      const kz = evaluateKillzoneFilter(new Date(curTime));
      if (!kz.active) continue;

      const c1h = all1h.filter(c => c.timestamp <= curTime);
      const c4h = all4h.filter(c => c.timestamp <= curTime);
      const c1m = all1m.filter(c => c.timestamp <= curTime);

      if (c1h.length < 15 || c4h.length < 15) continue;

      store.set(c15, c1h, c4h, c1m);

      const candidates = runPipeline(sym, store, notified);
      for (const candidate of candidates) {
        if (notified.hasBeenNotified(candidate.uniqueKey)) continue;
        notified.markAsNotified(candidate.uniqueKey);
        if (candidate.dedupeKey) notified.markAsNotified(candidate.dedupeKey);

        total15m += 1;

        // 15M Standart Simülasyon
        const future15 = all15m.slice(i + 1);
        const res15 = evaluateOutcome(candidate, future15, {
          entryWindowBars: 16,
          maxHoldBars: 48,
          entryMode: 'midpoint',
          targetRMultiple: 2.0,
          breakEvenTriggerR: 1.0,
        });

        let outcome15Str = 'UNRESOLVED', r15 = 0;
        if (res15.outcome) {
          if (res15.outcome.outcomeType === 'TAKE_PROFIT') {
            tp2_15m += 1; r15 = 2.0; outcome15Str = 'TP2 (+2.0R)';
          } else if (res15.outcome.outcomeType === 'BREAK_EVEN') {
            be_15m += 1; r15 = 0.5; outcome15Str = 'BE (+0.5R)';
          } else if (res15.outcome.outcomeType === 'STOP_LOSS') {
            sl_15m += 1; r15 = -1.0; outcome15Str = 'SL (-1.0R)';
          }
          netR_15m += r15;
        }

        // 1M Unicorn Sniper Simülasyonu
        const future1m = all1m.filter(c => c.timestamp >= curTime);
        const zoneLow = candidate.poiType === 'OB' ? candidate.poi.low : candidate.poi.gapLow;
        const zoneHigh = candidate.poiType === 'OB' ? candidate.poi.high : candidate.poi.gapHigh;

        const m1Res = evaluate1mUnicornSniperEntry({
          direction: candidate.tradeDirection,
          zoneLow,
          zoneHigh,
          symbol: sym,
          candles1m: future1m,
          maxWait1mBars: 90,
          requireFullUnicorn: false,
        });

        let outcome1mStr = 'VETO / NO_ENTRY', r1m = 0;

        if (m1Res.confirmed && m1Res.filledBarIndex !== null) {
          total1m += 1;
          const entry = m1Res.entryPrice;
          const sl = m1Res.stopLoss;
          const tp1 = m1Res.tp1Price;
          const tp2 = m1Res.tp2Price;
          const isLong = candidate.tradeDirection === 'long';

          let tp1Hit = false, closed = false;
          const exec1m = future1m.slice(m1Res.filledBarIndex + 1);

          for (const b of exec1m) {
            if (!tp1Hit) {
              const slHit = isLong ? b.low <= sl : b.high >= sl;
              const tp1HitCheck = isLong ? b.high >= tp1 : b.low <= tp1;
              if (slHit) {
                sl_1m += 1; r1m = -1.0; outcome1mStr = 'SL (-1.0R)'; closed = true; break;
              }
              if (tp1HitCheck) tp1Hit = true;
            } else {
              const beHit = isLong ? b.low <= entry : b.high >= entry;
              const tp2HitCheck = isLong ? b.high >= tp2 : b.low <= tp2;
              if (tp2HitCheck) {
                tp2_1m += 1; r1m = 2.0; outcome1mStr = '🎯 TP2 (+2.0R)'; closed = true; break;
              }
              if (beHit) {
                be_1m += 1; r1m = 0.5; outcome1mStr = '🛡️ BE (+0.5R)'; closed = true; break;
              }
            }
          }

          if (!closed) {
            if (tp1Hit) {
              be_1m += 1; r1m = 0.5; outcome1mStr = '🛡️ BE (+0.5R)';
            } else {
              outcome1mStr = 'TIME_EXIT (+0.0R)';
            }
          }
          netR_1m += r1m;
        } else {
          veto1m += 1;
          outcome1mStr = `⛔ ${m1Res.reason}`;
        }

        const dStr = new Date(curTime).toISOString().replace('T', ' ').slice(0, 16);
        const line = `${dStr} | ${sym.padEnd(7)} ${candidate.tradeDirection.toUpperCase().padEnd(5)} | ` +
                     `Grade: ${candidate.gradeResult.grade.padEnd(2)} | ` +
                     `15M CLT: ${outcome15Str.padEnd(12)} -> 1M Sniper: ${outcome1mStr}`;
        console.log(line);
        results.push(line);
      }
    }
  }

  console.log('\n' + '='.repeat(85));
  console.log('🏆 CLT (checklisttrigger) GERÇEK BİLANÇO:');
  console.log('-'.repeat(85));
  console.log('1) CLT 15M STANDART MODELİ (Orijinal SMC Motoru):');
  console.log(`   Toplam Sinyal  : ${total15m}`);
  console.log(`   TP2 (+2.0R)    : ${tp2_15m}`);
  console.log(`   BE  (+0.5R)    : ${be_15m}`);
  console.log(`   SL  (-1.0R)    : ${sl_15m}`);
  const wr15 = total15m > 0 ? ((tp2_15m + be_15m) / total15m * 100).toFixed(1) : '0';
  console.log(`   Win Rate       : %${wr15}`);
  console.log(`   Net R Getirisi : ${netR_15m >= 0 ? '+' : ''}${netR_15m.toFixed(1)} R`);
  console.log('-'.repeat(85));
  console.log('2) CLT 1M UNICORN SNIPER MODELİ (Entegre Edilen Yeni Mekanizma):');
  console.log(`   1M İcrasına Dolan: ${total1m} (1M onayı vermeyen / delinen ${veto1m} işlem elendi)`);
  console.log(`   🎯 Tam TP2     : ${tp2_1m} adet (+2.0R)`);
  console.log(`   🛡️ TP1 + BE    : ${tp2_1m >= 0 ? be_1m : 0} adet (+0.5R)`);
  console.log(`   🛑 Stop Loss   : ${sl_1m} adet (-1.0R)`);
  const wr1 = total1m > 0 ? ((tp2_1m + be_1m) / total1m * 100).toFixed(1) : '0';
  console.log(`   Win Rate       : %${wr1}`);
  console.log(`   Net R Getirisi : ${netR_1m >= 0 ? '+' : ''}${netR_1m.toFixed(1)} R`);
  console.log('='.repeat(85) + '\n');
}

runFastCltBenchmark();
