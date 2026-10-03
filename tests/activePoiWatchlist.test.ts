import * as fs from 'fs';
import * as path from 'path';
import { ActivePoiWatchlist } from '../server/activePoiWatchlist';

describe('ActivePoiWatchlist', () => {
  const testDir = path.join(__dirname, 'test_data_watchlist');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    ActivePoiWatchlist.resetInstance();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    ActivePoiWatchlist.resetInstance();
  });

  it('should register an active POI and return active symbols', () => {
    const watchlist = new ActivePoiWatchlist(testDir);
    const now = Date.now();

    const record = watchlist.registerOrUpdatePoi({
      symbol: 'EURUSD',
      timeframe: '15m',
      poiType: 'OB',
      direction: 'long',
      low: 1.0850,
      high: 1.0860,
      formedTimestamp: now - 10000,
      breakTimestamp: now - 5000,
      testCount: 0,
      isInvalidated: false,
    });

    expect(record.status).toBe('ACTIVE');
    expect(record.symbol).toBe('EURUSD');
    expect(watchlist.getActiveSymbols()).toEqual(['EURUSD']);
    expect(watchlist.getActivePois().length).toBe(1);
  });

  it('should mark POI as TESTED when notified and update active symbols', () => {
    const watchlist = new ActivePoiWatchlist(testDir);
    const now = Date.now();

    const record = watchlist.registerOrUpdatePoi({
      symbol: 'GBPUSD',
      timeframe: '15m',
      poiType: 'FVG',
      direction: 'long',
      low: 1.2750,
      high: 1.2760,
      formedTimestamp: now - 5000,
      breakTimestamp: now - 2000,
      testCount: 0,
    });

    expect(watchlist.getActiveSymbols()).toEqual(['GBPUSD']);

    watchlist.markPoiTested('GBPUSD', record.id);
    expect(watchlist.getActiveSymbols()).toEqual([]);
    expect(watchlist.getActivePois().length).toBe(0);

    const all = watchlist.getAllRecords();
    expect(all[0].status).toBe('TESTED');
  });

  it('should mark POI as INVALIDATED when candle closes beyond zone', () => {
    const watchlist = new ActivePoiWatchlist(testDir);
    const now = Date.now();

    const record = watchlist.registerOrUpdatePoi({
      symbol: 'USDJPY',
      timeframe: '15m',
      poiType: 'OB',
      direction: 'long',
      low: 155.20,
      high: 155.30,
      formedTimestamp: now - 10000,
      breakTimestamp: now - 5000,
    });

    expect(watchlist.getActiveSymbols()).toEqual(['USDJPY']);

    // Invalidation occurs
    watchlist.registerOrUpdatePoi({
      symbol: 'USDJPY',
      timeframe: '15m',
      poiType: 'OB',
      direction: 'long',
      low: 155.20,
      high: 155.30,
      formedTimestamp: now - 10000,
      breakTimestamp: now - 5000,
      isInvalidated: true,
    });

    expect(watchlist.getActiveSymbols()).toEqual([]);
    const all = watchlist.getAllRecords();
    expect(all[0].status).toBe('INVALIDATED');
  });

  it('should expire POIs older than DEFAULT_TTL_MS (24h)', () => {
    const watchlist = new ActivePoiWatchlist(testDir);
    const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago

    watchlist.registerOrUpdatePoi({
      symbol: 'BTCUSD',
      timeframe: '15m',
      poiType: 'OB',
      direction: 'long',
      low: 65000,
      high: 65100,
      formedTimestamp: oldTimestamp,
      breakTimestamp: oldTimestamp + 1000,
    });

    // Should already be EXPIRED due to age > TTL
    expect(watchlist.getActiveSymbols()).toEqual([]);
    const all = watchlist.getAllRecords();
    expect(all[0].status).toBe('EXPIRED');
  });

  it('should persist and recover POIs from disk', () => {
    const watchlist1 = new ActivePoiWatchlist(testDir);
    const now = Date.now();

    watchlist1.registerOrUpdatePoi({
      symbol: 'ETHUSD',
      timeframe: '15m',
      poiType: 'OB',
      direction: 'long',
      low: 3100,
      high: 3125,
      formedTimestamp: now - 1000,
      breakTimestamp: now - 500,
    });

    // New instance loading from same test directory
    const watchlist2 = new ActivePoiWatchlist(testDir);
    expect(watchlist2.getActiveSymbols()).toEqual(['ETHUSD']);
    const active = watchlist2.getActivePois();
    expect(active.length).toBe(1);
    expect(active[0].low).toBe(3100);
    expect(active[0].high).toBe(3125);
  });
});
