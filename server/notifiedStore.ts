import * as fs from 'fs';
import * as path from 'path';

export class NotifiedStore {
  private dataDir: string;
  private pending = new Set<string>();

  constructor(dataDir = 'data') {
    this.dataDir = path.isAbsolute(dataDir) ? dataDir : path.resolve(process.cwd(), dataDir);
  }

  private getFilePath(): string {
    return path.join(this.dataDir, 'notified_pois.json');
  }

  hasBeenNotified(uniqueKey: string): boolean {
    if (this.pending.has(uniqueKey)) return true;
    return this.hasDurablyBeenNotified(uniqueKey);
  }

  hasDurablyBeenNotified(uniqueKey: string): boolean {
    return this.readKeys().includes(uniqueKey);
  }

  /**
   * Checks whether any POI for the given symbol originating from `breakTimestamp` or a NEWER
   * structural break has already been notified (or is pending).
   * Prevents "peeling the onion" (falling back to older breaks or backup FVGs of the same break).
   */
  hasImpulseOrNewerBeenNotified(symbol: string, breakTimestamp: number): boolean {
    const prefix = `${symbol}_15m_`;
    const checkKey = (key: string): boolean => {
      if (!key.startsWith(prefix)) return false;
      // Signal ID format: ${pair}_${timeframe}_${poiType}_${formedTimestamp}_${eventTimestamp}
      const parts = key.split('_');
      if (parts.length !== 5) return false;
      const poiType = parts[2];
      if (poiType !== 'OB' && poiType !== 'FVG') return false;
      const notifiedBreakTs = Number(parts[4]);
      return Number.isFinite(notifiedBreakTs) && notifiedBreakTs >= breakTimestamp;
    };

    for (const key of this.pending) {
      if (checkKey(key)) return true;
    }
    const keys = this.readKeys();
    return keys.some(checkKey);
  }

  markPending(uniqueKey: string): void { this.pending.add(uniqueKey); }
  clearPending(uniqueKey: string): void { this.pending.delete(uniqueKey); }

  reservePending(keys: readonly string[]): boolean {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    if (uniqueKeys.some(key => this.hasBeenNotified(key))) return false;
    for (const key of uniqueKeys) this.pending.add(key);
    return true;
  }

  markAsNotified(uniqueKey: string): void {
    this.pending.delete(uniqueKey);
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const filePath = this.getFilePath();
    let keys = this.readKeys();

    if (!keys.includes(uniqueKey)) {
      keys.push(uniqueKey);
    }

    // Limit to 1000 keys (prune oldest 500)
    if (keys.length > 1000) {
      keys = keys.slice(keys.length - 500);
    }

    const tempFilePath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempFilePath, JSON.stringify(keys, null, 2), 'utf8');
      try {
        fs.renameSync(tempFilePath, filePath);
      } catch {
        fs.copyFileSync(tempFilePath, filePath);
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
    } catch (error) {
      try { fs.unlinkSync(tempFilePath); } catch {}
      throw new Error(`[NotifiedStore] Failed to persist ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private readKeys(): string[] {
    const filePath = this.getFilePath();
    if (!fs.existsSync(filePath)) return [];

    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) {
        throw new Error('file does not contain a valid string-array payload');
      }
      return parsed;
    } catch (error) {
      throw new Error(`[NotifiedStore] Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
