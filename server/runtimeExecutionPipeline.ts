import { generateExecutionPlan } from '../src/executionPlanner';
import { createExecutionPlanningPolicy } from '../src/executionPlanningPolicy';
import { createExecutionRuntimePolicy } from '../src/executionRuntimePolicy';
import { executePlan } from '../src/executionRuntime';
import { createExecutionSession } from '../src/executionSessionManager';
import { createExecutionSessionPolicy } from '../src/executionSessionPolicy';
import { executeSession } from '../src/executionEngineManager';
import { createExecutionEnginePolicy } from '../src/executionEnginePolicy';
import { createPaperExecutionPolicy } from '../src/paperExecutionPolicy';
import { paperExecute } from '../src/paperExecutionManager';
import { createSimulationExecutionPolicy } from '../src/simulationExecutionPolicy';
import { simulateExecution } from '../src/simulationExecutionManager';
import { createRiskPolicy } from '../src/riskPolicy';
import { evaluateRisk } from '../src/riskEngineManager';
import { calibrateDecision, DecisionCalibrationResult } from '../src/decisionCalibration';
import { generateRuntimeDecisionReport } from '../src/runtimeDecisionEvaluator';
import { DecisionReport } from '../src/decisionReport';
import { SignalContext, createSignalContext } from '../src/signalContext';
import { SignalLifecycleState } from '../src/signalLifecycle';
import { SignalOutcome, createWaitingEntryOutcome } from '../src/signalOutcome';
import { SignalBenchmark, createPendingSignalBenchmark } from '../src/signalBenchmark';
import { NoopSignalRepository, SignalRepository } from '../src/signalRepository';
import { defaultMarketDataOutcomeTracker } from '../src/signalOutcomeTracker';
import { NotificationCandidate } from './pipeline';

export interface RuntimeExecutionPipelineResult {
  readonly decisionReport: DecisionReport;
  readonly executionPlan: ReturnType<typeof generateExecutionPlan>;
  readonly runtimeResult: ReturnType<typeof executePlan>;
  readonly sessionResult: ReturnType<typeof createExecutionSession>;
  readonly engineResult: ReturnType<typeof executeSession>;
  readonly paperResult: ReturnType<typeof paperExecute>;
  readonly simulationResult: ReturnType<typeof simulateExecution>;
  readonly riskResult: ReturnType<typeof evaluateRisk>;
  readonly signalContext: SignalContext;
  readonly signalOutcome: SignalOutcome;
  readonly signalBenchmark: SignalBenchmark;
  readonly decisionCalibration: DecisionCalibrationResult;
}

export function runRuntimeExecutionPipeline(
  candidate: NotificationCandidate,
  repository: SignalRepository = new NoopSignalRepository()
): RuntimeExecutionPipelineResult {
  const candidateId = sanitizeId(candidate.signalId ?? candidate.uniqueKey);
  const decisionCalibration = calibrateDecision({
    tradeDirection: candidate.tradeDirection,
    bias4H: candidate.bias4H,
    bias1H: candidate.bias1H,
    pd4H: candidate.pd4H,
    pd1H: candidate.pd1H,
    pd15M: candidate.pd15M,
    poiTestCount: candidate.poiTestCount,
    grade: candidate.gradeResult.grade,
    score: candidate.gradeResult.totalScore,
    admissionProfile: candidate.admissionProfile,
    blockReasons: candidate.gradeResult.blockReasons,
    breakdown: candidate.gradeResult.breakdown,
  });
  const decisionReport = generateRuntimeDecisionReport({
    candidateId,
    gradeResult: candidate.gradeResult,
    calibration: decisionCalibration,
    policyId: `runtime-admission-policy:${candidateId}`,
    policyName: 'Runtime Candidate Admission',
    policyVersion: 1,
  });

  const executionPlan = generateExecutionPlan(decisionReport, createExecutionPlanningPolicy({
    planningId: `runtime-planning:${candidateId}`,
    name: 'Runtime Execution Planning',
    mode: 'SIMULATION',
    requireEligibleDecision: true,
    requiredExecutionEligibility: false,
    maximumPlannedActions: 1,
    allowedExecutionModes: ['PAPER', 'SIMULATION'],
    defaultExecutionIntent: 'PLAN_ONLY',
  }));

  const runtimeResult = executePlan(executionPlan, createExecutionRuntimePolicy({
    runtimeId: `runtime:${candidateId}`,
    runtimeMode: 'SIMULATION',
    supportedAdapters: ['SIMULATION'],
    maximumRuntimeItems: 1,
  }));

  const sessionResult = createExecutionSession(runtimeResult, createExecutionSessionPolicy({
    sessionId: `session:${candidateId}`,
    sessionMode: 'SIMULATION',
    maximumSessionItems: 1,
  }));

  const engineResult = executeSession(sessionResult, createExecutionEnginePolicy({
    engineId: `engine:${candidateId}`,
    engineMode: 'SIMULATION',
    maximumCommands: 1,
  }));

  const paperResult = paperExecute(engineResult, createPaperExecutionPolicy({
    paperExecutionId: `paper:${candidateId}`,
    maximumPaperItems: 1,
  }));

  const simulationResult = simulateExecution(engineResult, createSimulationExecutionPolicy({
    simulationExecutionId: `simulation:${candidateId}`,
    maximumSimulationItems: 1,
  }));

  const riskResult = evaluateRisk(simulationResult, createRiskPolicy({
    riskPolicyId: `risk:${candidateId}`,
    maximumRiskItems: 1,
  }));
  const firstRisk = riskResult.items[0];
  const hasPlannedAction = executionPlan.audit.plannedActions > 0;
  const hasReadyCommand = engineResult.audit.readyCommands > 0;
  const hasSimulatedItem = simulationResult.audit.simulatedItems > 0;
  const lifecycleStates: SignalLifecycleState[] = ['DETECTED', 'GRADED'];

  if (hasPlannedAction) lifecycleStates.push('PLANNED');
  if (hasReadyCommand) lifecycleStates.push('EXECUTION_READY');
  if (hasSimulatedItem) lifecycleStates.push('SIMULATED');
  if (firstRisk?.evaluation.executionAllowed) lifecycleStates.push('RISK_ACCEPTED');

  const signalContext = createSignalContext({
    signalId: candidate.signalId ?? candidate.uniqueKey,
    pair: candidate.symbol,
    direction: candidate.tradeDirection,
    timeframe: '15m',
    grade: candidate.gradeResult.grade,
    score: candidate.gradeResult.totalScore,
    executionStatus: engineResult.audit.readyCommands > 0 ? 'EXECUTION_READY' : 'EXECUTION_BLOCKED',
    riskStatus: firstRisk?.riskStatus ?? 'NO_RISK',
    timestamp: candidate.poi.relatedEvent.breakTimestamp,
    lifecycleStates,
  });
  const signalOutcome = createWaitingEntryOutcome(signalContext);
  const signalBenchmark = createPendingSignalBenchmark({ signalContext, signalOutcome });
  repository.createSignalRecord(signalContext);
  repository.saveOutcome(signalOutcome);
  repository.saveBenchmark(signalBenchmark);

  // Register only after the signal context has been created. The tracker evaluates
  // subsequent 15M market data; it does not treat the current signal candle as future data.
  if (firstRisk?.evaluation.executionAllowed) {
    defaultMarketDataOutcomeTracker.register({
      ...candidate,
      signalContext,
      signalId: candidate.signalId ?? candidate.uniqueKey,
    });
  }

  return Object.freeze({
    decisionReport,
    executionPlan,
    runtimeResult,
    sessionResult,
    engineResult,
    paperResult,
    simulationResult,
    riskResult,
    signalContext,
    signalOutcome,
    signalBenchmark,
    decisionCalibration,
  });
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_');
}
