import * as fs from 'fs';
import * as path from 'path';
import { loadMacroContext } from '../server/macroContext';

describe('Macro context cutoff safety', () => {
  const tempDir = path.join(process.cwd(), '.tmp-macro-test');
  const filePath = path.join(tempDir, 'fred.json');

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses only observations at or before the analysis cutoff', () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const day = (value: string) => Date.parse(value + 'T23:59:59Z');
    fs.writeFileSync(filePath, JSON.stringify([
      { seriesId: 'DFF', observedAt: day('2026-09-18'), value: 4, source: 'FRED_CSV' },
      { seriesId: 'DFF', observedAt: day('2026-09-19'), value: 9, source: 'FRED_CSV' },
      { seriesId: 'DGS10', observedAt: day('2026-09-18'), value: 4.1, source: 'FRED_CSV' },
      { seriesId: 'ECBDFR', observedAt: day('2026-09-18'), value: 2.5, source: 'FRED_CSV' },
      { seriesId: 'VIXCLS', observedAt: day('2026-09-18'), value: 16, source: 'FRED_CSV' },
    ]), 'utf8');

    const result = loadMacroContext(day('2026-09-18'), filePath);

    expect(result.policyRate).toBe(4);
    expect(result.ecbDepositRate).toBe(2.5);
    expect(result.vix).toBe(16);
  });
});
