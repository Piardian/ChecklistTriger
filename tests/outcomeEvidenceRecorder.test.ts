import { appendCompletedSignalOutcomeEvidenceAsync } from '../server/outcomeEvidenceRecorder';
import { CompletedSignalOutcomeEvidence } from '../src/signalEvidence';
import { EvidenceStore } from '../server/evidenceStore';

class MemoryEvidenceStore implements EvidenceStore {
  signals: unknown[] = [];
  outcomes: CompletedSignalOutcomeEvidence[] = [];

  async appendSignalEvidence(record: never): Promise<void> {
    this.signals.push(record);
  }

  async appendOutcomeEvidence(record: CompletedSignalOutcomeEvidence): Promise<void> {
    this.outcomes.push(record);
  }
}

test('persists deterministic evaluation metadata with completed outcome evidence', async () => {
  const store = new MemoryEvidenceStore();
  const evaluation = {
    version: 1 as const,
    entryPrice: 1.105,
    stopPrice: 1.0999,
    targetPrice: 1.1152,
    riskDistance: 0.0051,
    entryWindowBars: 16,
    maxHoldBars: 32,
    sameCandleResolution: 'STOP_LOSS_FIRST' as const,
    entryTriggeredAt: 1700000900000,
    evaluatedCandles: 7,
    evaluationStartTimestamp: 1700000000000,
    evaluationEndTimestamp: 1700007200000,
  };

  appendCompletedSignalOutcomeEvidenceAsync({
    signalId: 'S1',
    outcomeType: 'TP',
    holdingTimeMs: 6300000,
    rrAchieved: 2,
    maximumFavorableExcursion: 22,
    maximumAdverseExcursion: 4,
    exitTimestamp: 1700007200000,
    exitReason: 'Target reached.',
    evaluation,
  }, store);

  await Promise.resolve();
  expect(store.outcomes).toHaveLength(1);
  expect(store.outcomes[0].evaluation).toEqual(evaluation);
  expect(store.outcomes[0].outcome.type).toBe('TP');
});
