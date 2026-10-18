import * as fs from 'fs';
import * as path from 'path';
import { evaluate1mUnicornSniperEntry, calculateCeEntry, calculateDynamicStopBuffer } from '../src/entryMechanics';
import type { Candle } from '../src/types';

interface SignalEvidenceLine {
  evidenceSchemaVersion: number;
  metadata: {
    signalId: string;
    timestamp: number;
    symbol: string;
    direction: 'long' | 'short';
    timeframe: string;
  };
  poi: {
    poiType: string;
    timeframe: string;
    zoneHigh: number;
    zoneLow: number;
  };
  grade: {
    totalScore: number;
    grade: string;
    entryAllowed: boolean;
  };
}

interface ReplayTradeResult {
  signalId: string;
  symbol: string;
  direction: 'long' | 'short';
  timestamp: number;
  datetime: string;
  poiType: string;
  zoneLow: number;
  zoneHigh: number;
  status: 'OK' | 'INSUFFICIENT_DATA';
  insufficientReason?: string;
  // 15M Direct
  direct: {
    triggered: boolean;
    entryPrice: number | null;
    stopPrice: number | null;
    targetPrice: number | null;
    outcome: 'TP' | 'SL' | 'EXPIRED' | 'UNTRIGGERED';
    grossR: number;
    netR: number;
    holdingBars1m: number;
  };
  // 1M Confirmed
  confirmed: {
    triggered: boolean;
    entryPrice: number | null;
    stopPrice: number | null;
    targetPrice: number | null;
    outcome: 'TP' | 'SL' | 'SKIPPED_NO_CONFIRMATION' | 'EXPIRED';
    grossR: number;
    netR: number;
    holdingBars1m: number;
    reason: string;
  };
}

const BROKER_COST_R = 0.05; // 0.05R spread + commission drag per filled trade

function loadCandles1M(symbol: string): Candle[] {
  const filePath = path.resolve('data', `${symbol}_1m.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.candles || []);
    return list.map((c: any) => ({
      timestamp: c.timestamp || (c.time > 1e11 ? c.time : c.time * 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
    }));
  } catch {
    return [];
  }
}

function calculateMaxDrawdown(rSeries: number[]): number {
  let peak = 0;
  let running = 0;
  let maxDd = 0;
  for (const r of rSeries) {
    running += r;
    if (running > peak) {
      peak = running;
    }
    const dd = peak - running;
    if (dd > maxDd) {
      maxDd = dd;
    }
  }
  return Math.round(maxDd * 100) / 100;
}

export function runReplayVerification() {
  console.log('='.repeat(85));
  console.log('🔬 CHECKLISTTRIGGER 1M TEYİTLİ GİRİŞ VS 15M DOĞRUDAN LİMİT AMİRİK REPLAY 🔬');
  console.log('='.repeat(85));

  const signalsFile = path.resolve('evidence', 'signals', 'signal-evidence.jsonl');
  if (!fs.existsSync(signalsFile)) {
    console.error(`Sinyal dosyası bulunamadı: ${signalsFile}`);
    return;
  }

  // 1. Unique Approved Signals Yükle
  const rawLines = fs.readFileSync(signalsFile, 'utf8').split('\n').filter(Boolean);
  const uniqueSignals = new Map<string, SignalEvidenceLine>();

  const targetSymbols = new Set(['EURUSD', 'GBPUSD', 'USDCAD', 'USDJPY', 'XAUUSD']);
  // 3 Aylık Veri Penceresi (13 Temmuz 2026 - 13 Ekim 2026)
  const windowStart = new Date('2026-07-13T00:00:00Z').getTime();
  const windowEnd = new Date('2026-10-13T10:00:00Z').getTime();

  for (const line of rawLines) {
    try {
      const parsed: SignalEvidenceLine = JSON.parse(line);
      if (parsed.grade && parsed.grade.entryAllowed) {
        const sym = parsed.metadata.symbol;
        const ts = parsed.metadata.timestamp;
        const sid = parsed.metadata.signalId;
        if (targetSymbols.has(sym) && ts >= windowStart && ts <= windowEnd) {
          if (!uniqueSignals.has(sid)) {
            uniqueSignals.set(sid, parsed);
          }
        }
      }
    } catch {
      // skip corrupted json line
    }
  }

  console.log(`\n📌 3 Aylık Pencerede (13.07.2026 - 13.10.2026) Tespit Edilen Benzersiz Onaylı Sinyal: ${uniqueSignals.size} adet\n`);

  // 2. 1M Mum Verilerini Belleğe Al
  const candles1mMap = new Map<string, Candle[]>();
  for (const sym of targetSymbols) {
    const list = loadCandles1M(sym);
    // Sort chronologically
    list.sort((a, b) => a.timestamp - b.timestamp);
    candles1mMap.set(sym, list);
    console.log(`📡 [${sym}] 1M Bar Verisi Yüklendi: ${list.length} bar (Aralık: ${new Date(list[0]?.timestamp).toISOString().slice(0, 10)} - ${new Date(list[list.length - 1]?.timestamp).toISOString().slice(0, 10)})`);
  }

  const results: ReplayTradeResult[] = [];
  let insufficientDataCount = 0;

  for (const [sid, sig] of uniqueSignals.entries()) {
    const sym = sig.metadata.symbol;
    const direction = sig.metadata.direction;
    const isLong = direction === 'long';
    const sigTime = sig.metadata.timestamp;
    const zoneLow = sig.poi.zoneLow;
    const zoneHigh = sig.poi.zoneHigh;
    const allCandles = candles1mMap.get(sym) || [];

    // Binary search or find index for signal time
    const startIdx = allCandles.findIndex(c => c.timestamp >= sigTime);

    if (startIdx === -1 || startIdx + 600 > allCandles.length) {
      insufficientDataCount++;
      results.push({
        signalId: sid,
        symbol: sym,
        direction,
        timestamp: sigTime,
        datetime: new Date(sigTime).toISOString(),
        poiType: sig.poi.poiType,
        zoneLow,
        zoneHigh,
        status: 'INSUFFICIENT_DATA',
        insufficientReason: '1M bar verisi sinyal zamanından sonra yetersiz veya eksik',
        direct: { triggered: false, entryPrice: null, stopPrice: null, targetPrice: null, outcome: 'UNTRIGGERED', grossR: 0, netR: 0, holdingBars1m: 0 },
        confirmed: { triggered: false, entryPrice: null, stopPrice: null, targetPrice: null, outcome: 'SKIPPED_NO_CONFIRMATION', grossR: 0, netR: 0, holdingBars1m: 0, reason: 'INSUFFICIENT_DATA' }
      });
      continue;
    }

    // 16 Bar 15M = 240 Bar 1M (Maksimum Giriş Penceresi)
    // 32 Bar 15M = 480 Bar 1M (Maksimum Pozisyon Tutma Penceresi)
    const entryWindowCandles = allCandles.slice(startIdx, startIdx + 240);

    // Veri Sürekliliği Doğrulaması (INSUFFICIENT_DATA kontrolü)
    let hasGap = false;
    for (let k = 1; k < Math.min(60, entryWindowCandles.length); k++) {
      if (entryWindowCandles[k].timestamp - entryWindowCandles[k - 1].timestamp > 15 * 60 * 1000) {
        hasGap = true;
        break;
      }
    }
    if (hasGap || entryWindowCandles.length < 30) {
      insufficientDataCount++;
      results.push({
        signalId: sid,
        symbol: sym,
        direction,
        timestamp: sigTime,
        datetime: new Date(sigTime).toISOString(),
        poiType: sig.poi.poiType,
        zoneLow,
        zoneHigh,
        status: 'INSUFFICIENT_DATA',
        insufficientReason: '1M zaman serisinde 15 dakikadan uzun veri kopukluğu tespit edildi',
        direct: { triggered: false, entryPrice: null, stopPrice: null, targetPrice: null, outcome: 'UNTRIGGERED', grossR: 0, netR: 0, holdingBars1m: 0 },
        confirmed: { triggered: false, entryPrice: null, stopPrice: null, targetPrice: null, outcome: 'SKIPPED_NO_CONFIRMATION', grossR: 0, netR: 0, holdingBars1m: 0, reason: 'INSUFFICIENT_DATA' }
      });
      continue;
    }

    // =========================================================================
    // SENARYO A: 15M DOĞRUDAN LİMİT GİRİŞ (Direct Limit at POI Equilibrium)
    // =========================================================================
    const cePlan = calculateCeEntry({
      direction,
      zoneLow,
      zoneHigh,
      symbol: sym,
      entryModel: 'midpoint',
      targetRMultiple: 2.0,
      dynamicBuffer: true,
    });

    const dEntry = cePlan.entryPrice;
    const dStop = cePlan.stopPrice;
    const dTarget = cePlan.tp2Price; // 2.0R target
    const dRisk = cePlan.riskDistance;

    let directTriggeredIdx: number | null = null;
    for (let i = 0; i < entryWindowCandles.length; i++) {
      const c = entryWindowCandles[i];
      if (isLong ? c.low <= dEntry : c.high >= dEntry) {
        directTriggeredIdx = startIdx + i;
        break;
      }
    }

    let directOutcome: 'TP' | 'SL' | 'EXPIRED' | 'UNTRIGGERED' = 'UNTRIGGERED';
    let directGrossR = 0;
    let directNetR = 0;
    let directBarsHeld = 0;

    if (directTriggeredIdx !== null) {
      // 480 bar 1M tutma penceresi
      const postCandles = allCandles.slice(directTriggeredIdx + 1, directTriggeredIdx + 1 + 480);
      directBarsHeld = postCandles.length;
      let resolved = false;

      for (let j = 0; j < postCandles.length; j++) {
        const pc = postCandles[j];
        const hitSl = isLong ? pc.low <= dStop : pc.high >= dStop;
        const hitTp = isLong ? pc.high >= dTarget : pc.low <= dTarget;

        if (hitSl && hitTp) {
          // Conservative intra-bar: stop loss first
          directOutcome = 'SL';
          directGrossR = -1.0;
          directNetR = -1.0 - BROKER_COST_R;
          directBarsHeld = j + 1;
          resolved = true;
          break;
        } else if (hitSl) {
          directOutcome = 'SL';
          directGrossR = -1.0;
          directNetR = -1.0 - BROKER_COST_R;
          directBarsHeld = j + 1;
          resolved = true;
          break;
        } else if (hitTp) {
          directOutcome = 'TP';
          directGrossR = 2.0;
          directNetR = 2.0 - BROKER_COST_R;
          directBarsHeld = j + 1;
          resolved = true;
          break;
        }
      }

      if (!resolved) {
        // Max hold expired: close at market
        const lastCandle = postCandles[postCandles.length - 1];
        if (lastCandle) {
          const rawMove = isLong ? lastCandle.close - dEntry : dEntry - lastCandle.close;
          const endR = Math.max(-1.0, Math.min(2.0, rawMove / dRisk));
          directOutcome = 'EXPIRED';
          directGrossR = Math.round(endR * 100) / 100;
          directNetR = Math.round((endR - BROKER_COST_R) * 100) / 100;
        }
      }
    }

    // =========================================================================
    // SENARYO B: 1M TEYİTLİ GİRİŞ (CLT Unicorn Sniper Entry)
    // =========================================================================
    const sniperCandles1m = allCandles.slice(startIdx, startIdx + 240);
    const sniperRes = evaluate1mUnicornSniperEntry({
      direction,
      zoneLow,
      zoneHigh,
      symbol: sym,
      candles1m: sniperCandles1m,
      maxWait1mBars: 120, // 2 saat içinde 1M teyit oluşmalı
      requireFullUnicorn: false, // MSS + Breaker veya iFVG
    });

    let confOutcome: 'TP' | 'SL' | 'SKIPPED_NO_CONFIRMATION' | 'EXPIRED' = 'SKIPPED_NO_CONFIRMATION';
    let confGrossR = 0;
    let confNetR = 0;
    let confBarsHeld = 0;
    let confEntry: number | null = null;
    let confStop: number | null = null;
    let confTarget: number | null = null;

    if (sniperRes.confirmed && sniperRes.filledBarIndex !== null && sniperRes.entryPrice && sniperRes.stopLoss) {
      confEntry = sniperRes.entryPrice;
      confStop = sniperRes.stopLoss;
      const cRisk = Math.abs(confEntry - confStop);
      confTarget = isLong ? confEntry + cRisk * 2.0 : confEntry - cRisk * 2.0;

      const fillGlobalIdx = startIdx + sniperRes.filledBarIndex;
      const postCandles = allCandles.slice(fillGlobalIdx + 1, fillGlobalIdx + 1 + 480);
      confBarsHeld = postCandles.length;
      let resolved = false;

      for (let j = 0; j < postCandles.length; j++) {
        const pc = postCandles[j];
        const hitSl = isLong ? pc.low <= confStop : pc.high >= confStop;
        const hitTp = isLong ? pc.high >= confTarget : pc.low <= confTarget;

        if (hitSl && hitTp) {
          confOutcome = 'SL';
          confGrossR = -1.0;
          confNetR = -1.0 - BROKER_COST_R;
          confBarsHeld = j + 1;
          resolved = true;
          break;
        } else if (hitSl) {
          confOutcome = 'SL';
          confGrossR = -1.0;
          confNetR = -1.0 - BROKER_COST_R;
          confBarsHeld = j + 1;
          resolved = true;
          break;
        } else if (hitTp) {
          confOutcome = 'TP';
          confGrossR = 2.0;
          confNetR = 2.0 - BROKER_COST_R;
          confBarsHeld = j + 1;
          resolved = true;
          break;
        }
      }

      if (!resolved) {
        const lastCandle = postCandles[postCandles.length - 1];
        if (lastCandle) {
          const rawMove = isLong ? lastCandle.close - confEntry : confEntry - lastCandle.close;
          const endR = Math.max(-1.0, Math.min(2.0, rawMove / cRisk));
          confOutcome = 'EXPIRED';
          confGrossR = Math.round(endR * 100) / 100;
          confNetR = Math.round((endR - BROKER_COST_R) * 100) / 100;
        }
      }
    } else {
      // 1M teyit OLUŞMADI -> İŞLEM YAPILMADI (SKIPPED). PnL = 0.0R! Asla sahte kurtarılmış kâr sayılmaz!
      confOutcome = 'SKIPPED_NO_CONFIRMATION';
      confGrossR = 0.0;
      confNetR = 0.0;
    }

    results.push({
      signalId: sid,
      symbol: sym,
      direction,
      timestamp: sigTime,
      datetime: new Date(sigTime).toISOString(),
      poiType: sig.poi.poiType,
      zoneLow,
      zoneHigh,
      status: 'OK',
      direct: {
        triggered: directTriggeredIdx !== null,
        entryPrice: dEntry,
        stopPrice: dStop,
        targetPrice: dTarget,
        outcome: directOutcome,
        grossR: directGrossR,
        netR: directNetR,
        holdingBars1m: directBarsHeld,
      },
      confirmed: {
        triggered: sniperRes.confirmed && sniperRes.filledBarIndex !== null,
        entryPrice: confEntry,
        stopPrice: confStop,
        targetPrice: confTarget,
        outcome: confOutcome,
        grossR: confGrossR,
        netR: confNetR,
        holdingBars1m: confBarsHeld,
        reason: sniperRes.reason || 'NO_CONFIRMATION',
      }
    });
  }

  // =========================================================================
  // İSTATİSTİKSEL KARŞILAŞTIRMA VE ADİL PERFORMANS RAPORU
  // =========================================================================
  const validResults = results.filter(r => r.status === 'OK');
  console.log(`\n================================================================================`);
  console.log(`📊 DOĞRULANAN VERİ HAVUZU: ${validResults.length} ADET SİNYAL (${insufficientDataCount} Sinyal INSUFFICIENT_DATA)`);
  console.log(`================================================================================`);

  // Senaryo A: 15M Doğrudan Limit
  const dFilled = validResults.filter(r => r.direct.triggered);
  const dWins = dFilled.filter(r => r.direct.outcome === 'TP');
  const dLosses = dFilled.filter(r => r.direct.outcome === 'SL');
  const dExpired = dFilled.filter(r => r.direct.outcome === 'EXPIRED');
  const dUntriggered = validResults.filter(r => !r.direct.triggered);
  const dTotalNetR = dFilled.reduce((acc, r) => acc + r.direct.netR, 0);
  const dAvgR = dFilled.length > 0 ? dTotalNetR / dFilled.length : 0;
  const dWinRate = dFilled.length > 0 ? (dWins.length / dFilled.length) * 100 : 0;
  const dMdd = calculateMaxDrawdown(dFilled.map(r => r.direct.netR));

  // Senaryo B: 1M Teyitli Giriş (Unicorn Sniper)
  const cFilled = validResults.filter(r => r.confirmed.triggered);
  const cWins = cFilled.filter(r => r.confirmed.outcome === 'TP');
  const cLosses = cFilled.filter(r => r.confirmed.outcome === 'SL');
  const cSkipped = validResults.filter(r => !r.confirmed.triggered);
  const cTotalNetR = cFilled.reduce((acc, r) => acc + r.confirmed.netR, 0);
  const cAvgR = cFilled.length > 0 ? cTotalNetR / cFilled.length : 0;
  const cWinRate = cFilled.length > 0 ? (cWins.length / cFilled.length) * 100 : 0;
  const cMdd = calculateMaxDrawdown(cFilled.map(r => r.confirmed.netR));

  console.log('\n--- 1. SENARYO A: 15M DOĞRUDAN LİMİT GİRİŞ ---');
  console.log(`Toplam Tetiklenen İşlem: ${dFilled.length} / ${validResults.length} (Tetiklenmeyen/Untriggered: ${dUntriggered.length})`);
  console.log(`Kazanan (TP)            : ${dWins.length} adet (%${dWinRate.toFixed(1)})`);
  console.log(`Kaybeden (SL)           : ${dLosses.length} adet (%${(dFilled.length > 0 ? (dLosses.length / dFilled.length) * 100 : 0).toFixed(1)})`);
  console.log(`Zaman Aşımı (Expired)   : ${dExpired.length} adet`);
  console.log(`Net Kâr/Zarar (Net R)   : ${dTotalNetR.toFixed(2)}R (Broker Maliyetleri Dahil)`);
  console.log(`İşlem Başına Beklenti   : ${dAvgR.toFixed(2)}R`);
  console.log(`Maksimum Drawdown (MDD) : -${dMdd.toFixed(2)}R`);

  console.log('\n--- 2. SENARYO B: 1M TEYİTLİ GİRİŞ (CLT Unicorn Sniper) ---');
  console.log(`Toplam Tetiklenen İşlem: ${cFilled.length} / ${validResults.length} (Teyit Almayan / Skipped: ${cSkipped.length})`);
  console.log(`Kazanan (TP)            : ${cWins.length} adet (%${cWinRate.toFixed(1)})`);
  console.log(`Kaybeden (SL)           : ${cLosses.length} adet (%${(cFilled.length > 0 ? (cLosses.length / cFilled.length) * 100 : 0).toFixed(1)})`);
  console.log(`Net Kâr/Zarar (Net R)   : ${cTotalNetR.toFixed(2)}R (Broker Maliyetleri Dahil)`);
  console.log(`İşlem Başına Beklenti   : ${cAvgR.toFixed(2)}R`);
  console.log(`Maksimum Drawdown (MDD) : -${cMdd.toFixed(2)}R`);

  // Adli Ayrışma Analizi: 1M teyidinin filtrelediği işlemlerin gerçek akıbeti
  console.log('\n--- 3. ADİL FİLTRELEME ANALİZİ (1M Teyidinin Atlattığı İşlemlerin Gerçek Yüzü) ---');
  const directSlFilteredBy1M = validResults.filter(r => r.direct.outcome === 'SL' && !r.confirmed.triggered);
  const directTpFilteredBy1M = validResults.filter(r => r.direct.outcome === 'TP' && !r.confirmed.triggered);

  console.log(`15M'in SL olduğu ancak 1M'in girmeyerek koruduğu gerçek zarar: ${directSlFilteredBy1M.length} işlem`);
  console.log(`15M'in TP olduğu ancak 1M teyit vermediği için kaçırılan gerçek kâr: ${directTpFilteredBy1M.length} işlem`);
  const netFilterBenefit = (directSlFilteredBy1M.length * 1.05) - (directTpFilteredBy1M.length * 1.95);
  console.log(`Net Gerçek Filtreleme Avantajı (Önlenen Zarar - Kaçırılan Kâr): ${netFilterBenefit > 0 ? '+' : ''}${netFilterBenefit.toFixed(2)}R`);

  // İlk 5 İşlem Dökümü
  console.log('\n--- 4. İŞLEM BAZINDA DÖKÜM (İlk 5 Sinyal) ---');
  for (let i = 0; i < Math.min(5, validResults.length); i++) {
    const r = validResults[i];
    console.log(`\n[${i + 1}] ${r.symbol} ${r.direction.toUpperCase()} @ ${r.datetime}`);
    console.log(`    POI: ${r.poiType} [${r.zoneLow} - ${r.zoneHigh}]`);
    console.log(`    15M Doğrudan Limit: ${r.direct.outcome} -> ${r.direct.netR > 0 ? '+' : ''}${r.direct.netR}R (Held: ${r.direct.holdingBars1m} bar)`);
    console.log(`    1M Teyitli Giriş  : ${r.confirmed.outcome} -> ${r.confirmed.netR > 0 ? '+' : ''}${r.confirmed.netR}R (Reason: ${r.confirmed.reason})`);
  }

  // Raporu Kaydet
  const reportPayload = {
    generatedAt: new Date().toISOString(),
    totalSignalsFound: uniqueSignals.size,
    validSignalsEvaluated: validResults.length,
    insufficientDataCount,
    scenarioA_direct15m: {
      filledTrades: dFilled.length,
      untriggeredTrades: dUntriggered.length,
      wins: dWins.length,
      losses: dLosses.length,
      expired: dExpired.length,
      winRatePct: Math.round(dWinRate * 10) / 10,
      totalNetR: Math.round(dTotalNetR * 100) / 100,
      expectancyR: Math.round(dAvgR * 100) / 100,
      maxDrawdownR: dMdd,
    },
    scenarioB_confirmed1m: {
      filledTrades: cFilled.length,
      skippedTrades: cSkipped.length,
      wins: cWins.length,
      losses: cLosses.length,
      winRatePct: Math.round(cWinRate * 10) / 10,
      totalNetR: Math.round(cTotalNetR * 100) / 100,
      expectancyR: Math.round(cAvgR * 100) / 100,
      maxDrawdownR: cMdd,
    },
    filterForensics: {
      avoidedRealLossesCount: directSlFilteredBy1M.length,
      missedRealWinsCount: directTpFilteredBy1M.length,
      netFilterAlphaR: Math.round(netFilterBenefit * 100) / 100,
    },
    sampleTrades: validResults.slice(0, 15),
  };

  const outPath = path.resolve('data', 'real_1m_vs_15m_replay_report.json');
  fs.writeFileSync(outPath, JSON.stringify(reportPayload, null, 2), 'utf8');
  console.log(`\n✅ Ampririk Doğrulama Raporu Kaydedildi: ${outPath}`);
}

if (require.main === module) {
  runReplayVerification();
}
