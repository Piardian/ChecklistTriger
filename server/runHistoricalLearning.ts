import * as fs from 'fs';
import * as path from 'path';
import { generateHistoricalLearningReport } from '../src/historicalLearningPipeline';

const outputFile = path.resolve(process.env.HISTORICAL_LEARNING_REPORT_FILE ?? 'evidence/learning/historical-learning-report.json');

function main(): void {
  const result = generateHistoricalLearningReport();
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    coverage: result.dataset.coverage,
    adapter: {
      readErrors: result.readErrors,
      skippedSignalCount: result.skippedSignalCount,
      skippedOutcomeCount: result.skippedOutcomeCount,
    },
    benchmark: result.segmentedBenchmark,
    learning: result.learningReport,
    temporalSplit: result.temporalSplit ? {
      trainFraction: result.temporalSplit.trainFraction,
      trainSampleSize: result.temporalSplit.train.items.length,
      outOfSampleSampleSize: result.temporalSplit.outOfSample.items.length,
      trainCutoffTimestamp: result.temporalSplit.trainCutoffTimestamp,
    } : null,
    outOfSampleBenchmark: result.outOfSampleSegmentedBenchmark ?? null,
    outOfSampleValidation: result.outOfSampleValidation,
  }, null, 2), 'utf8');

  console.log(`[HistoricalLearning] wrote ${outputFile}`);
  console.log(`[HistoricalLearning] labeled=${result.dataset.coverage.labeledCount}/${result.dataset.coverage.snapshotCount}`);
  console.log(`[HistoricalLearning] patterns=${result.learningReport.overallLearning.learnedPatterns}`);
  console.log(`[HistoricalLearning] oos=${result.outOfSampleValidation.status}`);
}

main();
