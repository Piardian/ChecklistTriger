import * as path from 'path';

process.env.REPLAY_DATA_DIR = path.resolve('data', 'replay_1year');
process.env.REPLAY_SYMBOLS = 'BTCUSD,ETHUSD,SOLUSD,LTCUSD,EURUSD,GBPUSD,XAUUSD';
process.env.REPLAY_EVIDENCE_DIR = path.resolve('evidence', 'replay_1year');
process.env.HISTORICAL_MARKET_REPLAY_BATCH_REPORT_FILE = path.resolve(
  'evidence',
  'replay_1year',
  'historical-market-replay-1year-report.json'
);

console.log('[1YearReplay] Starting 1-year batch historical replay on 7 symbols...');
console.log(`[1YearReplay] Data Directory: ${process.env.REPLAY_DATA_DIR}`);
console.log(`[1YearReplay] Symbols: ${process.env.REPLAY_SYMBOLS}`);

require('./runHistoricalMarketReplayBatch');
