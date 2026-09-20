import {
  CompletedSignalOutcomeEvaluationEvidence,
  CompletedSignalOutcomeEvidence,
  createCompletedSignalOutcomeEvidence,
} from '../src/signalEvidence';
import { EvidenceStore, JsonlEvidenceStore } from './evidenceStore';

const defaultStore = new JsonlEvidenceStore();

export interface OutcomeEvidenceAppendInput {
  readonly signalId: string;
  readonly outcomeType: CompletedSignalOutcomeEvidence['outcome']['type'];
  readonly holdingTimeMs?: number | null;
  readonly holdingBars?: number | null;
  readonly rrAchieved?: number | null;
  readonly maximumFavorableExcursion?: number | null;
  readonly maximumAdverseExcursion?: number | null;
  readonly exitTimestamp: number;
  readonly exitPrice?: number | null;
  readonly exitReason: string;
  readonly entry?: CompletedSignalOutcomeEvidence['entry'];
  readonly risk?: CompletedSignalOutcomeEvidence['risk'];
  readonly evaluation?: CompletedSignalOutcomeEvaluationEvidence | null;
}

export async function appendCompletedSignalOutcomeEvidenceAsync(
  input: OutcomeEvidenceAppendInput,
  store: EvidenceStore = defaultStore
): Promise<void> {
  if (process.env.ENABLE_EVIDENCE_RECORDER === 'false') return;

  const entry = input.entry ?? (input.evaluation ? {
    triggered: input.evaluation.entryTriggeredAt !== null,
    timestamp: input.evaluation.entryTriggeredAt,
    price: input.evaluation.entryPrice,
    entryMode: input.evaluation.entryMode ?? 'midpoint',
  } : undefined);

  const risk = input.risk ?? (input.evaluation ? {
    stop: input.evaluation.stopPrice,
    target: input.evaluation.targetPrice,
    riskDistance: input.evaluation.riskDistance,
    targetR: input.evaluation.targetRMultiple ?? 2,
  } : undefined);

  const record = createCompletedSignalOutcomeEvidence({
    signalId: input.signalId,
    outcome: {
      type: input.outcomeType,
      holdingTimeMs: input.holdingTimeMs ?? null,
      holdingBars: input.holdingBars ?? input.evaluation?.holdingBars ?? null,
      rrAchieved: input.rrAchieved ?? null,
      maximumFavorableExcursion: input.maximumFavorableExcursion ?? null,
      maximumAdverseExcursion: input.maximumAdverseExcursion ?? null,
      exitTimestamp: input.exitTimestamp,
      exitPrice: input.exitPrice ?? null,
      exitReason: input.exitReason,
    },
    entry,
    risk,
    ...(input.evaluation ? { evaluation: input.evaluation } : {}),
  });

  await store.appendOutcomeEvidence(record);
}

