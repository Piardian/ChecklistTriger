import { CompletedSignalOutcomeEvaluationEvidence, createCompletedSignalOutcomeEvidence } from '../src/signalEvidence';
import { EvidenceStore, JsonlEvidenceStore } from './evidenceStore';

const defaultStore = new JsonlEvidenceStore();

export interface CompletedOutcomeEvidenceInput {
  readonly signalId: string;
  readonly outcomeType: CompletedSignalOutcomeEvaluationType;
  readonly holdingTimeMs?: number | null;
  readonly rrAchieved?: number | null;
  readonly maximumFavorableExcursion?: number | null;
  readonly maximumAdverseExcursion?: number | null;
  readonly exitTimestamp: number;
  readonly exitReason: string;
  readonly evaluation: CompletedSignalOutcomeEvaluationEvidence;
}

type CompletedSignalOutcomeEvaluationType = 'TP' | 'SL' | 'BE' | 'MANUAL' | 'EXPIRED' | 'CANCELLED' | 'UNKNOWN';

export function appendCompletedOutcomeEvidenceAsync(
  input: CompletedOutcomeEvidenceInput,
  store: EvidenceStore = defaultStore
): void {
  if (process.env.ENABLE_EVIDENCE_RECORDER === 'false') return;

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
    evaluation: input.evaluation,
  });

  void store.appendOutcomeEvidence(record).catch(error => {
    console.warn(`[OutcomeEvidenceWriter] Outcome evidence write failed for ${record.signalId}:`, error);
  });
}
