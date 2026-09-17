import { CompletedSignalOutcomeEvaluationEvidence, CompletedSignalOutcomeEvidence, createCompletedSignalOutcomeEvidence } from '../src/signalEvidence';
import { EvidenceStore, JsonlEvidenceStore } from './evidenceStore';

const defaultStore = new JsonlEvidenceStore();

export interface OutcomeEvidenceAppendInput {
  readonly signalId: string;
  readonly outcomeType: CompletedSignalOutcomeEvidence['outcome']['type'];
  readonly holdingTimeMs?: number | null;
  readonly rrAchieved?: number | null;
  readonly maximumFavorableExcursion?: number | null;
  readonly maximumAdverseExcursion?: number | null;
  readonly exitTimestamp: number;
  readonly exitReason: string;
  readonly evaluation?: CompletedSignalOutcomeEvaluationEvidence | null;
}

export function appendCompletedSignalOutcomeEvidenceAsync(
  input: OutcomeEvidenceAppendInput,
  store: EvidenceStore = defaultStore
): void {
  if (process.env.ENABLE_EVIDENCE_RECORDER === 'false') {
    return;
  }

  const record = createCompletedSignalOutcomeEvidence({
    signalId: input.signalId,
    outcome: {
      type: input.outcomeType,
      holdingTimeMs: input.holdingTimeMs ?? null,
      rrAchieved: input.rrAchieved ?? null,
      maximumFavorableExcursion: input.maximumFavorableExcursion ?? null,
      maximumAdverseExcursion: input.maximumAdverseExcursion ?? null,
      exitTimestamp: input.exitTimestamp,
      exitReason: input.exitReason,
    },
    ...(input.evaluation ? { evaluation: input.evaluation } : {}),
  });

  void store.appendOutcomeEvidence(record).catch(error => {
    console.warn(`[EvidenceRecorder] Outcome evidence write failed for ${record.signalId}:`, error);
  });
}
