import * as fs from 'fs';
import * as path from 'path';
import { NotifiedStore } from '../server/notifiedStore';

describe('Notified POI Store', () => {
  const testDir = path.join(__dirname, 'temp_notified_store_test');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should return false if notified_pois.json is missing', () => {
    const store = new NotifiedStore(testDir);
    expect(store.hasBeenNotified('some_key')).toBe(false);
  });

  test('should record and check notifications', () => {
    const store = new NotifiedStore(testDir);
    const key = 'EURUSD_15m_OB_12_15';

    expect(store.hasBeenNotified(key)).toBe(false);
    store.markAsNotified(key);
    expect(store.hasBeenNotified(key)).toBe(true);
  });

  test('fails closed when durable notification state is corrupt', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'notified_pois.json'), '{ invalid json', 'utf8');
    const store = new NotifiedStore(testDir);

    expect(() => store.hasBeenNotified('some_key')).toThrow(/Failed to read/);
    expect(() => store.markAsNotified('new_key')).toThrow(/Failed to read/);
    expect(fs.readFileSync(path.join(testDir, 'notified_pois.json'), 'utf8')).toBe('{ invalid json');
  });

  test('rejects structurally invalid durable state', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'notified_pois.json'), JSON.stringify({ key: 'value' }), 'utf8');
    const store = new NotifiedStore(testDir);

    expect(() => store.hasDurablyBeenNotified('key')).toThrow(/valid string-array payload/);
  });

  test('atomically reserves and releases all pending keys', () => {
    const store = new NotifiedStore(testDir);

    expect(store.reservePending(['signal-key', 'dedupe-key'])).toBe(true);
    expect(store.reservePending(['signal-key', 'another-key'])).toBe(false);

    store.clearPending('signal-key');
    store.clearPending('dedupe-key');
    expect(store.reservePending(['signal-key', 'dedupe-key'])).toBe(true);
  });

  test('should cap and prune list when it exceeds 1000 keys limit', () => {
    const store = new NotifiedStore(testDir);

    // Add 1001 keys
    for (let i = 0; i < 1001; i++) {
      store.markAsNotified(`key_${i}`);
    }

    // Key 0 (oldest) should have been pruned (since limit was 1000 and we prunned 500)
    expect(store.hasBeenNotified('key_0')).toBe(false);
    // Key 500 should also be pruned
    expect(store.hasBeenNotified('key_500')).toBe(false);
    // Key 501 should remain
    expect(store.hasBeenNotified('key_501')).toBe(true);
    // Key 1000 should remain
    expect(store.hasBeenNotified('key_1000')).toBe(true);
  });
});
