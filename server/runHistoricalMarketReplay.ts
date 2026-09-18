import * as fs from 'fs';
import * as path from 'path';
import {
  HistoricalMarketReplayDataset,
  runHistoricalMarketReplay,
} from '../src/historicalMarketReplay';
import { StoredCandle } from './candleStore';
import { ALL_SYMBOLS, Symbol } from './universe';

import { readAndExportResearchDataset } from '../src/researchDatasetExporter';

const REPLAY_SYMBOLS = [...ALL_SYMBOLS, 'BTCEUR', 'ETHEUR', 'LTCEUR'] as const;

type ReplaySymbol = (typeof REPLAY_SYMBOLS)[number];

function main(): void {
  const symbol = readSymbol(process.env.REPLAY_SYMBOL ?? 'EURUSD');
  const dataset = {
    symbol,
    candles15m: readCandles(process.env.REPLAY_15M_FILE ?? `data/${symbol}_15m.json`),
    candles1h: readCandles(process.env.REPLAY_1H_FILE ?? `data/${symbol}_1h.json`),
    candles4h: readCandles(process.env.REPLAY_4H_FILE ?? `data/${symbol}_4h.json`),
  } satisfies HistoricalMarketReplayDataset;

  const startedTimestamp = optionalNumber(process.env.REPLAY_STARTED_TIMESTAMP);
  const finishedTimestamp = optionalNumber(process.env.REPLAY_FINISHED_TIMESTAMP);
  const respectMarketWindow = optionalBoolean(process.env.REPLAY_RESPECT_MARKET_WINDOW, true);
  const respectKillzone = optionalBoolean(process.env.REPLAY_RESPECT_KILLZONE, true);
  const recordEvidence = optionalBoolean(process.env.REPLAY_RECORD_EVIDENCE, true);
  const evidenceDir = process.env.REPLAY_EVIDENCE_DIR ?? 'evidence/replay';
  const includePricePath = optionalBoolean(process.env.REPLAY_INCLUDE_PRICE_PATH, true);
  const cleanEvidence = optionalBoolean(process.env.REPLAY_CLEAN_EVIDENCE, true);

  if (recordEvidence && cleanEvidence) {
    fs.rmSync(path.join(evidenceDir, 'signals'), { recursive: true, force: true });
    fs.rmSync(path.join(evidenceDir, 'outcomes'), { recursive: true, force: true });
    fs.rmSync(path.join(evidenceDir, 'price-paths'), { recursive: true, force: true });
  }

  const session = runHistoricalMarketReplay(dataset, {
    startedTimestamp,
    finishedTimestamp,
    respectMarketWindow,
    respectKillzone,
    recordEvidence,
    evidenceDir,
    includePricePath,
  });

  const outputFile = path.resolve(
    process.env.HISTORICAL_MARKET_REPLAY_REPORT_FILE ??
      path.join(evidenceDir, 'historical-market-replay-report.json')
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(session, null, 2), 'utf8');

  let exportedRows = 0;
  if (recordEvidence && session.candidateCount > 0) {
    const signalsFile = path.join(evidenceDir, 'signals', 'signal-evidence.jsonl');
    const outcomesFile = path.join(evidenceDir, 'outcomes', 'outcome-evidence.jsonl');
    const pricePathsFile = path.join(evidenceDir, 'price-paths', 'price-path-evidence.jsonl');
    const datasetJson = path.join(evidenceDir, 'research-dataset.json');
    const datasetCsv = path.join(evidenceDir, 'research-dataset.csv');

    const jsonExport = readAndExportResearchDataset({
      signalsFile,
      outcomesFile,
      pricePathsFile,
      outputFile: datasetJson,
      format: 'json',
    });
    readAndExportResearchDataset({
      signalsFile,
      outcomesFile,
      pricePathsFile,
      outputFile: datasetCsv,
      format: 'csv',
    });
    exportedRows = jsonExport.rows.length;
    console.log(`[HistoricalMarketReplay] dataset exported (${exportedRows} rows): ${datasetJson} & ${datasetCsv}`);
  }

  const tpCount = session.trades.filter(t => t.outcomeStatus === 'TAKE_PROFIT').length;
  const slCount = session.trades.filter(t => t.outcomeStatus === 'STOP_LOSS').length;
  const expCount = session.trades.filter(t => t.outcomeStatus === 'EXPIRED').length;
  const unresCount = session.trades.filter(t => t.outcomeStatus === 'UNRESOLVED').length;
  const resolvedCount = tpCount + slCount;
  const winRate = resolvedCount > 0 ? (tpCount / resolvedCount) * 100 : null;

  console.log(`[HistoricalMarketReplay] report=${outputFile}`);
  console.log(
    `[HistoricalMarketReplay] symbol=${session.symbol} steps=${session.replayStepCount} ` +
      `candidates=${session.candidateCount} completed=${session.completedOutcomeCount} ` +
      `unresolved=${session.unresolvedOutcomeCount} ` +
      `TP=${tpCount} SL=${slCount} EXPIRED=${expCount} UNRESOLVED=${unresCount} ` +
      `winRate=${winRate !== null ? winRate.toFixed(1) + '%' : 'N/A'}`
  );
}

function readCandles(fileName: string): StoredCandle[] {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Historical market replay candle file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Historical market replay could not parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Historical market replay candle file must contain an array: ${filePath}`);
  }

  return parsed.map((value, index) => {
    if (!isStoredCandle(value)) {
      throw new Error(`Historical market replay candle ${index} in ${filePath} is invalid.`);
    }
    return value;
  });
}

function isStoredCandle(value: unknown): value is StoredCandle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(candidate.timestamp) &&
    Number.isFinite(candidate.open) &&
    Number.isFinite(candidate.high) &&
    Number.isFinite(candidate.low) &&
    Number.isFinite(candidate.close);
}

function readSymbol(value: string): Symbol {
  if (!REPLAY_SYMBOLS.includes(value as ReplaySymbol)) {
    throw new Error(`Unsupported REPLAY_SYMBOL: ${value}`);
  }
  return value as Symbol;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a finite numeric timestamp, received: ${value}`);
  }
  return parsed;
}

function optionalBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received: ${value}`);
}

main();
