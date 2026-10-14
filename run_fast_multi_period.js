process.env.ENABLE_TELEMETRY = 'false';

const fs = require('fs');
const path = require('path');
const { detectSwings } = require('./dist/src/swingDetector');
const { detectStructure } = require('./dist/src/structureDetector');
const { runPipeline } = require('./dist/server/pipeline');
const { evaluateOutcome } = require('./dist/src/signalOutcomeTracker');
const { evaluate1mUnicornSniperEntry } = require('./dist/src/entryMechanics');
const { evaluateKillzoneFilter } = require('./dist/server/killzone');

class FastCandleStore {
  constructor() {
    this.c15m = [];
    this.c1h = [];
    this.c4h = [];
  }
  set(c15m, c1h, c4h) {
    this.c15m = c15m;
    this.c1h = c1h;
    this.c4h = c4h;
  }
  getCandles(_s, tf) {
    if (tf === '15m') return this.c15m;
    if (tf === '1h') return this.c1h;
    if (tf === '4h') return this.c4h;
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

function runBenchmark(label, startTimestamp, endTimestamp, run1mSniper) {
  console.log('\n' + '='.repeat(85));
  console.log(`🌺 CLT (checklisttrigger / swing-bos-core) ${label.toUpperCase()} 🌺`);
  console.log(`   Başlangıç : ${new Date(startTimestamp).toISOString().slice(0, 10)}`);
  console.log(`   Bitiş     : ${new Date(endTimestamp).toISOString().slice(0, 10)}`);
  console.log(`   1M Sniper Teyidi: ${run1mSniper ? 'AKTİF (Gerçek 1M Barları ile)' : 'DEVRE DIŞI (Sadece 15M SMC Modeli)'}`);
  console.log('='.repeat(85) + '\n');

  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'SOLUSD'];

  let total15m = 0, tp2_15m = 0, be_15m = 0, sl_15m = 0, netR_15m = 0;
  let total1m = 0, tp2_1m = 0, be_1m = 0, sl_1m = 0, netR_1m = 0, veto1m = 0;

  const tradeList = [];

  for (const sym of symbols) {
    const f15 = path.resolve('data', `${sym}_15m.json`);
    const f1h = path.resolve('data', `${sym}_1h.json`);
    const f4h = path.resolve('data', `${sym}_4h.json`);
    const f1m = path.resolve('data', `${sym}_1m.json`);

    if (!fs.existsSync(f15) || !fs.existsSync(f1h) || !fs.existsSync(f4h)) continue;

    const all15m = JSON.parse(fs.readFileSync(f15, 'utf8'));
    const all1h = JSON.parse(fs.readFileSync(f1h, 'utf8'));
    const all4h = JSON.parse(fs.readFileSync(f4h, 'utf8'));
    const all1m = (run1mSniper && fs.existsSync(f1m)) ? JSON.parse(fs.readFileSync(f1m, 'utf8')) : [];

    // Kırılım olaylarını tespit et
    const swings = detectSwings(all15m);
    const struct = detectStructure(all15m, swings);
    const breakIndices = Array.from(new Set(struct.events.map(e => e.breakCandleIndex))).sort((a,b) => a-b);

    const store = new FastCandleStore();
    const notified = new FastNotifiedStore();

    for (const idx of breakIndices) {
      if (idx < 50 || idx >= all15m.length - 15) continue;
      const curTime = all15m[idx].timestamp;

      if (curTime < startTimestamp || curTime > endTimestamp) continue;

      // Killzone kontrolü
      const kz = evaluateKillzoneFilter(new Date(curTime));
      if (!kz.active) continue;

      const c15 = all15m.slice(Math.max(0, idx - 150), idx + 1);
      const c1h = all1h.filter(c => c.timestamp <= curTime).slice(-100);
      const c4h = all4h.filter(c => c.timestamp <= curTime).slice(-60);

      if (c1h.length < 15 || c4h.length < 15) continue;

      store.set(c15, c1h, c4h);
      const candidates = runPipeline(sym, store, notified);

      for (const candidate of candidates) {
        if (notified.hasBeenNotified(candidate.uniqueKey)) continue;
        notified.markAsNotified(candidate.uniqueKey);
        if (candidate.dedupeKey) notified.markAsNotified(candidate.dedupeKey);

        total15m += 1;

        // 15M Standart Çıktı
        const future15 = all15m.slice(idx + 1);
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

        let outcome1mStr = 'N/A';
        if (run1mSniper && all1m.length > 0) {
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

          let r1m = 0;
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
        }

        const dStr = new Date(curTime).toISOString().replace('T', ' ').slice(0, 16);
        const logLine = `${dStr} | ${sym.padEnd(7)} ${candidate.tradeDirection.toUpperCase().padEnd(5)} | ` +
                        `Grade: ${candidate.gradeResult.grade.padEnd(2)} | ` +
                        `15M CLT: ${outcome15Str.padEnd(12)} -> 1M Sniper: ${outcome1mStr}`;
        tradeList.push(logLine);
      }
    }
  }

  console.log('📋 İŞLEMLER LİSTESİ:');
  console.log('-'.repeat(85));
  for (const t of tradeList) {
    console.log(t);
  }
  if (tradeList.length === 0) {
    console.log('Bu periyotta üretilen Grade A/A+ işlem bulunamadı.');
  }
  console.log('-'.repeat(85) + '\n');

  console.log('🏆 BİLANÇO:');
  console.log('-'.repeat(85));
  console.log('1) CLT 15M STANDART MODELİ:');
  console.log(`   Toplam Sinyal  : ${total15m}`);
  console.log(`   TP2 (+2.0R)    : ${tp2_15m}`);
  console.log(`   BE  (+0.5R)    : ${be_15m}`);
  console.log(`   SL  (-1.0R)    : ${sl_15m}`);
  const wr15 = total15m > 0 ? ((tp2_15m + be_15m) / total15m * 100).toFixed(1) : '0';
  console.log(`   Win Rate       : %${wr15}`);
  console.log(`   Net R Getirisi : ${netR_15m >= 0 ? '+' : ''}${netR_15m.toFixed(1)} R`);

  if (run1mSniper) {
    console.log('-'.repeat(85));
    console.log('2) CLT 1M UNICORN SNIPER MODELİ:');
    console.log(`   1M İcrasına Dolan: ${total1m} (1M onayı vermeyen / delinen ${veto1m} işlem elendi)`);
    console.log(`   🎯 Tam TP2     : ${tp2_1m} adet (+2.0R)`);
    console.log(`   🛡️ TP1 + BE    : ${be_1m} adet (+0.5R)`);
    console.log(`   🛑 Stop Loss   : ${sl_1m} adet (-1.0R)`);
    const wr1 = total1m > 0 ? ((tp2_1m + be_1m) / total1m * 100).toFixed(1) : '0';
    console.log(`   Win Rate       : %${wr1}`);
    console.log(`   Net R Getirisi : ${netR_1m >= 0 ? '+' : ''}${netR_1m.toFixed(1)} R`);
  }
  console.log('='.repeat(85) + '\n');
}

// 1. 1 Aylık Test (11 Eylül 2026 - 11 Ekim 2026)
const t_end_1m = new Date('2026-10-11T23:59:59Z').getTime();
const t_start_1m = new Date('2026-09-11T00:00:00Z').getTime();
runBenchmark('1 Aylık Test (Son 30 Gün)', t_start_1m, t_end_1m, true);

// 2. 3 Aylık Test (13 Temmuz 2026 - 13 Ekim 2026 - Tam 95.000 1M Barı)
const t_end_3m = new Date('2026-10-13T10:00:00Z').getTime();
const t_start_3m = new Date('2026-07-13T00:00:00Z').getTime();
runBenchmark('3 Aylık Test (Tam 1M Sniper Dahil)', t_start_3m, t_end_3m, true);

// 3. 1 Yıllık Test (13 Ekim 2025 - 13 Ekim 2026 - 15M CLT SMC Çekirdek Modeli)
const t_end_1y = new Date('2026-10-13T10:00:00Z').getTime();
const t_start_1y = new Date('2025-10-13T00:00:00Z').getTime();
runBenchmark('1 Yıllık Test (15M CLT SMC Çekirdek Modeli)', t_start_1y, t_end_1y, false);
