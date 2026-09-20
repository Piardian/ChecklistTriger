import * as fs from 'fs';
import * as path from 'path';
import type { GradeResult } from '../src/gradeCalculator';
import type { DisplacementQuality, FVG, OrderBlock, PremiumDiscountState, StructureEvent } from '../src/types';
import type { ModelState } from '../src/modelDeterminer';
import type { SweepEvent } from '../src/sweepDetector';
import type { LiquidityMagnet } from '../src/liquidityMagnetDetector';
import type { OpposingObstacle } from '../src/opposingObstacleDetector';
import type { SignalQualityResult } from '../src/signalQualityEngine';
import type { SetupAssessment } from '../src/setupAssessment';

export const RESEARCH_LEDGER_SCHEMA_VERSION = 1 as const;
export type ResearchEvaluationStage = 'FILTER_REJECTED' | 'GRADED_REJECTED' | 'CONSOLIDATED_REJECTED' | 'CANDIDATE';

export interface ResearchPoiEvaluation {
  readonly schemaVersion: typeof RESEARCH_LEDGER_SCHEMA_VERSION;
  readonly recordId: string;
  readonly observedAt: number;
  readonly cutoffTimestamp: number;
  readonly stage: ResearchEvaluationStage;
  readonly symbol: string;
  readonly timeframe: '15m';
  readonly direction: 'long' | 'short';
  readonly poiType: 'OB' | 'FVG';
  readonly poi: { low: number; high: number; formedTimestamp: number; formedIndex: number };
  readonly relatedEvent: StructureEvent;
  readonly blockingRules: readonly string[];
  readonly features: {
    readonly bias4H: string;
    readonly bias1H: string;
    readonly bias15M: string;
    readonly pd4H: PremiumDiscountState;
    readonly pd1H: PremiumDiscountState;
    readonly pd15M: PremiumDiscountState;
    readonly poiAgeBars: number;
    readonly poiAgeMs: number;
    readonly poiTestCount: number;
    readonly distancePips: number;
    readonly distanceAtr: number | null;
    readonly atrPips: number | null;
    readonly oppositeStructureEventsSinceOrigin: readonly unknown[];
    readonly displacement: DisplacementQuality | null;
    readonly modelState: ModelState | null;
    readonly triggeringSweep: SweepEvent | null;
    readonly liquidityMagnet: LiquidityMagnet | null;
    readonly opposingObstacle: OpposingObstacle | null;
    readonly grade: GradeResult | null;
    readonly signalQuality: SignalQualityResult | null;
    readonly setupAssessmentV2: SetupAssessment | null;
  };
  readonly rulebook: {
    readonly gradeVersion: string | null;
    readonly setupQualityVersion: string | null;
  };
}

const seenKeys = new Set<string>();

export function appendResearchPoiEvaluation(input: Omit<ResearchPoiEvaluation, 'schemaVersion' | 'recordId'>): void {
  const recordId = [input.symbol, input.timeframe, input.poiType, input.poi.formedTimestamp, input.observedAt, input.stage, input.blockingRules.join('|')].join(':');
  if (seenKeys.has(recordId)) return;
  seenKeys.add(recordId);

  const record: ResearchPoiEvaluation = Object.freeze({
    schemaVersion: RESEARCH_LEDGER_SCHEMA_VERSION,
    recordId,
    ...input,
  });

  const filePath = process.env.RESEARCH_LEDGER_PATH ?? path.join('evidence', 'research', 'setup-evaluations.jsonl');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

export function researchPoiInputBase(input: {
  symbol: string;
  direction: 'long' | 'short';
  poiType: 'OB' | 'FVG';
  poi: OrderBlock | FVG;
  observedAt: number;
  formedTimestamp: number;
  pd4H: PremiumDiscountState;
  pd1H: PremiumDiscountState;
  pd15M: PremiumDiscountState;
  bias4H: string;
  bias1H: string;
  bias15M: string;
  distancePips: number;
  distanceAtr: number | null;
  atrPips: number | null;
  oppositeStructureEventsSinceOrigin: readonly unknown[];
  poiTestCount: number;
  displacement: DisplacementQuality | null;
  modelState: ModelState | null;
  triggeringSweep: SweepEvent | null;
  liquidityMagnet: LiquidityMagnet | null;
  opposingObstacle: OpposingObstacle | null;
  grade: GradeResult | null;
  signalQuality: SignalQualityResult | null;
  setupAssessmentV2: SetupAssessment | null;
  blockingRules: readonly string[];
  stage: ResearchEvaluationStage;
  setupQualityVersion?: string | null;
}): Omit<ResearchPoiEvaluation, 'schemaVersion' | 'recordId'> {
  const formedIndex = input.poiType === 'OB'
    ? (input.poi as OrderBlock).formedAtIndex
    : (input.poi as FVG).middleCandleIndex;
  const formedTimestamp = input.formedTimestamp;
  const zone = input.poiType === 'OB'
    ? { low: (input.poi as OrderBlock).low, high: (input.poi as OrderBlock).high }
    : { low: (input.poi as FVG).gapLow, high: (input.poi as FVG).gapHigh };
  return {
    observedAt: input.observedAt, cutoffTimestamp: input.observedAt, stage: input.stage,
    symbol: input.symbol, timeframe: '15m', direction: input.direction, poiType: input.poiType,
    poi: { low: zone.low, high: zone.high, formedTimestamp, formedIndex },
    relatedEvent: input.poi.relatedEvent, blockingRules: input.blockingRules,
    features: {
      bias4H: input.bias4H, bias1H: input.bias1H, bias15M: input.bias15M,
      pd4H: input.pd4H, pd1H: input.pd1H, pd15M: input.pd15M,
      poiAgeBars: Math.max(0, Math.floor((input.observedAt - formedTimestamp) / (15 * 60 * 1000))),
      poiAgeMs: Math.max(0, input.observedAt - formedTimestamp),
      poiTestCount: input.poiTestCount, distancePips: input.distancePips, distanceAtr: input.distanceAtr, atrPips: input.atrPips,
      oppositeStructureEventsSinceOrigin: input.oppositeStructureEventsSinceOrigin, displacement: input.displacement,
      modelState: input.modelState, triggeringSweep: input.triggeringSweep, liquidityMagnet: input.liquidityMagnet,
      opposingObstacle: input.opposingObstacle, grade: input.grade, signalQuality: input.signalQuality,
      setupAssessmentV2: input.setupAssessmentV2,
    },
    rulebook: {
      gradeVersion: input.grade?.rulebookVersion ?? null,
      setupQualityVersion: input.setupQualityVersion ?? input.setupAssessmentV2?.decision.rulebookVersion ?? null,
    },
  };
}
