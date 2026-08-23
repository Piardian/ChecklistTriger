import { createSignalContext } from '../src/signalContext';
import { createWaitingEntryOutcome } from '../src/signalOutcome';
import { createPendingSignalBenchmark, SIGNAL_BENCHMARK_VERSION } from '../src/signalBenchmark';

describe('Signal Benchmark Foundation', () => {
  test('creates immutable PENDING benchmark linked to one Signal ID', () => {
    const signalContext = createSignalContext({
      signalId: 'EURUSD_15m_OB_1717400000000_1717407600000',
      pair: 'EURUSD',
      direction: 'long',
      timeframe: '15m',
      grade: 'A+',
      score: 9,
      executionStatus: 'EXECUTION_READY',
      riskStatus: 'ACCEPTED',
      timestamp: 1717407600000,
      lifecycleStates: ['DETECTED', 'GRADED', 'PLANNED', 'EXECUTION_READY', 'SIMULATED', 'RISK_ACCEPTED'],
    });
    const signalOutcome = createWaitingEntryOutcome(signalContext);
    const benchmark = createPendingSignalBenchmark({ signalContext, signalOutcome });

    expect(benchmark.version).toBe(SIGNAL_BENCHMARK_VERSION);
    expect(benchmark.signalId).toBe(signalContext.signalId);
    expect(benchmark.prediction).toEqual({ predictedGrade: 'A+', predictedScore: 9 });
    expect(benchmark.reality).toEqual({ outcomeType: 'WAITING_ENTRY', outcomeVersion: signalOutcome.version });
    expect(benchmark.benchmarkStatus).toBe('PENDING');
    expect(benchmark.metadata.decisionMade).toBe(false);
    expect(benchmark.metadata.learningApplied).toBe(false);
    expect(benchmark.metadata.policyEvolutionApplied).toBe(false);
    expect(Object.isFrozen(benchmark)).toBe(true);
    expect(Object.isFrozen(benchmark.prediction)).toBe(true);
    expect(Object.isFrozen(benchmark.reality)).toBe(true);
    expect(Object.isFrozen(benchmark.metadata)).toBe(true);
  });
});

