import * as fs from 'fs';
import * as path from 'path';
import { MACRO_SOURCE, MacroSeriesObservation } from './macroContext';

const SERIES = ['DFF', 'DGS10', 'DTWEXBGS', 'CPIAUCSL', 'UNRATE', 'PAYEMS'] as const;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const months = Number(args.months ?? '24');
  const output = args.output ?? process.env.MACRO_CONTEXT_FILE ?? path.join('data', 'macro', 'fred.json');
  if (!Number.isFinite(months) || months <= 0) throw new Error('--months must be a positive number');

  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - Math.ceil(months), end.getUTCDate()));
  const observations: MacroSeriesObservation[] = [];

  for (const seriesId of SERIES) {
    const url = new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');
    url.searchParams.set('id', seriesId);
    url.searchParams.set('cosd', start.toISOString().slice(0, 10));
    url.searchParams.set('coed', end.toISOString().slice(0, 10));
    const response = await fetch(url);
    if (!response.ok) throw new Error('FRED ' + seriesId + ' request failed: HTTP ' + response.status);
    observations.push(...parseFredCsv(seriesId, await response.text()));
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(observations, null, 2) + '\n', 'utf8');
  console.log('Wrote ' + observations.length + ' macro observations to ' + output);
}

function parseFredCsv(seriesId: string, csv: string): MacroSeriesObservation[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const valueColumn = header.indexOf(seriesId);
  if (valueColumn < 0) throw new Error('FRED ' + seriesId + ' CSV column missing');
  const result: MacroSeriesObservation[] = [];
  for (const line of lines.slice(1)) {
    const columns = line.split(',');
    const value = Number(columns[valueColumn]);
    const timestamp = Date.parse(columns[0] + 'T23:59:59Z');
    if (!Number.isFinite(value) || !Number.isFinite(timestamp)) continue;
    result.push({ seriesId, observedAt: timestamp, value, source: MACRO_SOURCE });
  }
  return result;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args[key] = 'true';
    else { args[key] = value; index += 1; }
  }
  return args;
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
