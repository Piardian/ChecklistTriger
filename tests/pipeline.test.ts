import * as fs from 'fs';
import * as path from 'path';
import { CandleStore } from '../server/candleStore';
import { NotifiedStore } from '../server/notifiedStore';
import { runPipeline } from '../server/pipeline';
import { Candle, SwingPoint } from '../src/types';
import * as scorerModule from '../src/displacementQualityScorer';

describe('Pipeline Orchestrator', () => {
  const testDir = path.join(__dirname, 'temp_pipeline_test');
  let candleStore: CandleStore;
  let notifiedStore: NotifiedStore;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.ENABLE_SIGNAL_QUALITY_ENGINE;
    candleStore = new CandleStore(testDir);
    notifiedStore = new NotifiedStore(testDir);
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should return empty list if candles are missing or length < 15', () => {
    const res = runPipeline('EURUSD', candleStore, notifiedStore);
    expect(res).toEqual([]);
  });

  test('should terminate and return empty list if bias4H is not directional (e.g. range)', () => {
    // Fill 15 dummy candles on 4h, 1h, 15m
    for (let i = 0; i < 20; i++) {
      candleStore.appendCandle('EURUSD', '4h', { timestamp: i * 1000, open: 100, high: 100, low: 100, close: 100 });
      candleStore.appendCandle('EURUSD', '1h', { timestamp: i * 1000, open: 100, high: 100, low: 100, close: 100 });
      candleStore.appendCandle('EURUSD', '15m', { timestamp: i * 1000, open: 100, high: 100, low: 100, close: 100 });
    }

    const res = runPipeline('EURUSD', candleStore, notifiedStore);
    // Since bias4H is undefined or range, it stops immediately.
    expect(res).toEqual([]);
  });

  test('should run entire pipeline end-to-end, trigger candidates on strong setups, deduplicate notifications, and skip weak setups', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push({
        timestamp: i * 1000,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
      });
    }

    // Swing Low 1 at index 4
    candles[2].low = 60;
    candles[3].low = 55;
    candles[4].low = 50;
    candles[5].low = 70;
    candles[6].low = 75;

    // Swing High 1 at index 8
    candles[6].high = 110;
    candles[7].high = 120;
    candles[8].high = 150;
    candles[9].high = 130;
    candles[10].high = 125;

    // Swing Low 2 at index 12
    candles[10].low = 120;
    candles[11].low = 110;
    candles[12].low = 90;
    candles[13].low = 100;
    candles[14].low = 105;

    // Set close at index 13 to be in discount zone (relative to High 1 and Low 1)
    candles[13].close = 85;

    // Swing High 2 at index 16
    candles[14].high = 110;
    candles[15].high = 115;
    candles[16].high = 200;
    candles[17].high = 115;
    candles[17].low = 115;
    candles[17].open = 115;
    candles[17].close = 115; // doji

    // Displacement leg (indices 18, 19, 20)
    candles[18].open = 120;
    candles[18].close = 150;
    candles[18].high = 150;
    candles[18].low = 120;

    candles[19].open = 150;
    candles[19].close = 180;
    candles[19].high = 180;
    candles[19].low = 150;

    candles[20].open = 180;
    candles[20].close = 220; // breakout of High 2 (200)
    candles[20].high = 220;
    candles[20].low = 195;

    // Populate candleStore with separate 4H/1H context and 15M execution structure.
    appendPipelineCandles(candleStore, 'EURUSD', candles);

    // First run should trigger notifications
    const res1 = runPipeline('EURUSD', candleStore, notifiedStore);
    expect(res1.length).toBeGreaterThan(0);
    expect(res1[0].gradeResult.entryAllowed).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res1[0], 'signalQualityResult')).toBe(false);

    // Detection remains side-effect free until the delivery layer owns the candidate.
    const res2 = runPipeline('EURUSD', candleStore, notifiedStore);
    expect(res2.map(candidate => candidate.uniqueKey)).toEqual(res1.map(candidate => candidate.uniqueKey));

    for (const candidate of res1) {
      notifiedStore.markAsNotified(candidate.uniqueKey);
      if (candidate.dedupeKey) notifiedStore.markAsNotified(candidate.dedupeKey);
    }
    expect(runPipeline('EURUSD', candleStore, notifiedStore)).toEqual([]);
  });

  test('should attach SignalQualityResult only when observer feature flag is enabled', () => {
    process.env.ENABLE_SIGNAL_QUALITY_ENGINE = 'true';

    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push({
        timestamp: Date.UTC(2024, 5, 3, 7, i, 0),
        open: 100,
        high: 100,
        low: 100,
        close: 100,
      });
    }

    candles[2].low = 60;
    candles[3].low = 55;
    candles[4].low = 50;
    candles[5].low = 70;
    candles[6].low = 75;
    candles[6].high = 110;
    candles[7].high = 120;
    candles[8].high = 150;
    candles[9].high = 130;
    candles[10].high = 125;
    candles[10].low = 120;
    candles[11].low = 110;
    candles[12].low = 90;
    candles[13].low = 100;
    candles[14].low = 105;
    candles[13].close = 85;
    candles[14].high = 110;
    candles[15].high = 115;
    candles[16].high = 200;
    candles[17].high = 115;
    candles[17].low = 115;
    candles[17].open = 115;
    candles[17].close = 115;
    candles[18].open = 120;
    candles[18].close = 150;
    candles[18].high = 150;
    candles[18].low = 120;
    candles[19].open = 150;
    candles[19].close = 180;
    candles[19].high = 180;
    candles[19].low = 150;
    candles[20].open = 180;
    candles[20].close = 110;
    candles[20].high = 110;
    candles[20].low = 97;

    appendPipelineCandles(candleStore, 'EURUSD', candles);

    const res = runPipeline('EURUSD', candleStore, notifiedStore);

    expect(res.length).toBeGreaterThan(0);
    expect(res[0].signalQualityResult?.version).toBe(1);
    expect(res[0].gradeResult.entryAllowed).toBe(true);
  });

  test('should completely skip candidates if displacement quality gradePoints is less than 1 or null', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push({ timestamp: i * 1000, open: 100, high: 100, low: 100, close: 100 });
    }
    candles[2].low = 60; candles[3].low = 55; candles[4].low = 50; candles[5].low = 70; candles[6].low = 75;
    candles[6].high = 110; candles[7].high = 120; candles[8].high = 150; candles[9].high = 130; candles[10].high = 125;
    candles[10].low = 120; candles[11].low = 110; candles[12].low = 90; candles[13].low = 100; candles[14].low = 105;
    candles[13].close = 85;
    candles[14].high = 110; candles[15].high = 115; candles[16].high = 200;
    candles[17].high = 115; candles[17].low = 115; candles[17].open = 115; candles[17].close = 115;

    candles[18].open = 120; candles[18].close = 150; candles[18].high = 150; candles[18].low = 120;
    candles[19].open = 150; candles[19].close = 180; candles[19].high = 180; candles[19].low = 150;
    candles[20].open = 180; candles[20].close = 220; candles[20].high = 220; candles[20].low = 180;

    candles.forEach(c => {
      candleStore.appendCandle('EURUSD', '4h', c);
      candleStore.appendCandle('EURUSD', '1h', c);
      candleStore.appendCandle('EURUSD', '15m', c);
    });

    // Mock displacement quality to return null (insufficient data) or gradePoints = 0
    const mockDq = jest.spyOn(scorerModule, 'scoreDisplacementQuality').mockReturnValue({
      legDirection: 'bullish',
      bodyRatioScore: 0,
      consecutiveScore: 0,
      fvgScore: 0,
      sizeScore: 0,
      totalScore: 0,
      quality: 'zayıf',
      gradePoints: 0,
    });

    const res = runPipeline('EURUSD', candleStore, notifiedStore);
    expect(res).toEqual([]); // Completely skipped

    mockDq.mockRestore();
  });

  test('should process normally and trigger candidates if displacement quality gradePoints is 1 or more', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push({ timestamp: i * 1000, open: 100, high: 100, low: 100, close: 100 });
    }
    candles[2].low = 60; candles[3].low = 55; candles[4].low = 50; candles[5].low = 70; candles[6].low = 75;
    candles[6].high = 110; candles[7].high = 120; candles[8].high = 150; candles[9].high = 130; candles[10].high = 125;
    candles[10].low = 120; candles[11].low = 110; candles[12].low = 90; candles[13].low = 100; candles[14].low = 105;
    candles[13].close = 85;
    candles[14].high = 110; candles[15].high = 115; candles[16].high = 200;
    candles[17].high = 115; candles[17].low = 115; candles[17].open = 115; candles[17].close = 115;

    candles[18].open = 120; candles[18].close = 150; candles[18].high = 150; candles[18].low = 120;
    candles[19].open = 150; candles[19].close = 180; candles[19].high = 180; candles[19].low = 150;
    candles[20].open = 180; candles[20].close = 110; candles[20].high = 110; candles[20].low = 97;

    appendPipelineCandles(candleStore, 'GBPUSD', candles);

    const mockDq = jest.spyOn(scorerModule, 'scoreDisplacementQuality').mockReturnValue({
      legDirection: 'bullish',
      bodyRatioScore: 1,
      consecutiveScore: 1,
      fvgScore: 1,
      sizeScore: 1,
      totalScore: 4,
      quality: 'güçlü',
      gradePoints: 2,
    });

    const res = runPipeline('GBPUSD', candleStore, notifiedStore);
    expect(res.length).toBeGreaterThan(0);

    mockDq.mockRestore();
  });
});

function appendPipelineCandles(
  candleStore: CandleStore,
  symbol: 'EURUSD' | 'GBPUSD',
  candles15m: Candle[]
): void {
  // The 15M fixture creates the local bullish BOS/OB.
  candles15m[4].low = 50;
  candles15m[8].high = 90;
  candles15m[12].low = 80;
  candles15m[16].high = 100;
  candles15m[14].high = 95;
  candles15m[14].low = 90;
  candles15m[15].high = 97;
  candles15m[15].low = 92;
  candles15m[17] = {
    timestamp: candles15m[17].timestamp,
    open: 99,
    high: 99.5,
    low: 90,
    close: 95,
  };
  candles15m[18] = {
    timestamp: candles15m[18].timestamp,
    open: 95,
    high: 98,
    low: 94.5,
    close: 97,
  };
  candles15m[19] = {
    timestamp: candles15m[19].timestamp,
    open: 97,
    high: 99,
    low: 96.5,
    close: 98,
  };
  candles15m[20] = {
    timestamp: candles15m[20].timestamp,
    open: 98,
    high: 110,
    low: 97,
    close: 110,
  };

  // 4H/1H context stays bullish, but current price remains in 4H Discount.
  const contextCandles = candles15m.map(candle => ({ ...candle }));
  contextCandles[4].low = 50;
  contextCandles[8].high = 150;
  contextCandles[12].low = 80;
  contextCandles[16].high = 200;
  contextCandles[13].close = 85;
  contextCandles[20].close = 110;

  contextCandles.forEach(candle => {
    candleStore.appendCandle(symbol, '4h', candle);
    candleStore.appendCandle(symbol, '1h', candle);
  });
  candles15m.forEach(candle => candleStore.appendCandle(symbol, '15m', candle));
}
