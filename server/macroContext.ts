import * as fs from 'fs';
import * as path from 'path';

export const MACRO_CONTEXT_SCHEMA_VERSION = 1 as const;
export const MACRO_SOURCE = 'FRED_CSV' as const;
export type MacroAvailability = 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';

export interface MacroSeriesObservation {
  readonly seriesId: string;
  readonly observedAt: number;
  readonly value: number;
  readonly source: typeof MACRO_SOURCE;
}

export interface MacroContext {
  readonly schemaVersion: typeof MACRO_CONTEXT_SCHEMA_VERSION;
  readonly availability: MacroAvailability;
  readonly source: typeof MACRO_SOURCE | 'NONE';
  readonly cutoffTimestamp: number;
  readonly latestObservedAt: number | null;
  readonly freshnessMs: number | null;
  readonly policyRate: number | null;
  readonly us10yYield: number | null;
  readonly usdTradeWeightedIndex: number | null;
  readonly cpiYoY: number | null;
  readonly unemploymentRate: number | null;
  readonly payrollsMoMThousands: number | null;
  readonly seriesCoverage: readonly string[];
}

const SERIES_IDS = Object.freeze({
  policyRate: 'DFF',
  us10yYield: 'DGS10',
  usdTradeWeightedIndex: 'DTWEXBGS',
  cpi: 'CPIAUCSL',
  unemployment: 'UNRATE',
  payrolls: 'PAYEMS',
});

export function loadMacroContext(
  cutoffTimestamp: number,
  filePath = process.env.MACRO_CONTEXT_FILE ?? path.join('data', 'macro', 'fred.json')
): MacroContext {
  const unavailable = (): MacroContext => ({
    schemaVersion: MACRO_CONTEXT_SCHEMA_VERSION,
    availability: 'UNAVAILABLE',
    source: 'NONE',
    cutoffTimestamp,
    latestObservedAt: null,
    freshnessMs: null,
    policyRate: null,
    us10yYield: null,
    usdTradeWeightedIndex: null,
    cpiYoY: null,
    unemploymentRate: null,
    payrollsMoMThousands: null,
    seriesCoverage: [],
  });

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const observations = Array.isArray(parsed) ? parsed.filter(isMacroObservation) : [];
    if (observations.length === 0) return unavailable();

    const latestBySeries = new Map<string, MacroSeriesObservation>();
    for (const observation of observations) {
      if (observation.observedAt > cutoffTimestamp) continue;
      const existing = latestBySeries.get(observation.seriesId);
      if (!existing || observation.observedAt > existing.observedAt) latestBySeries.set(observation.seriesId, observation);
    }

    const latestValues = [...latestBySeries.values()];
    const latestObservedAt = latestValues.length > 0 ? Math.max(...latestValues.map(item => item.observedAt)) : null;
    const freshnessMs = latestObservedAt === null ? null : Math.max(0, cutoffTimestamp - latestObservedAt);
    const staleThresholdMs = 45 * 24 * 60 * 60 * 1000;
    const requiredCoverage = Object.values(SERIES_IDS);
    const seriesCoverage = requiredCoverage.filter(seriesId => latestBySeries.has(seriesId));

    const cpiObservation = latestBySeries.get(SERIES_IDS.cpi);
    const payrollObservation = latestBySeries.get(SERIES_IDS.payrolls);
    const priorCpi = findPriorObservation(observations, SERIES_IDS.cpi, cpiObservation?.observedAt ?? null, 365);
    const priorPayrolls = findPriorObservation(observations, SERIES_IDS.payrolls, payrollObservation?.observedAt ?? null, 31);

    const availability: MacroAvailability =
      latestObservedAt === null ? 'UNAVAILABLE' :
      latestObservedAt < cutoffTimestamp - staleThresholdMs ? 'STALE' :
      'AVAILABLE';

    return {
      schemaVersion: MACRO_CONTEXT_SCHEMA_VERSION,
      availability,
      source: MACRO_SOURCE,
      cutoffTimestamp,
      latestObservedAt,
      freshnessMs,
      policyRate: latestBySeries.get(SERIES_IDS.policyRate)?.value ?? null,
      us10yYield: latestBySeries.get(SERIES_IDS.us10yYield)?.value ?? null,
      usdTradeWeightedIndex: latestBySeries.get(SERIES_IDS.usdTradeWeightedIndex)?.value ?? null,
      cpiYoY: cpiObservation && priorCpi !== null && priorCpi !== 0 ? (cpiObservation.value / priorCpi - 1) * 100 : null,
      unemploymentRate: latestBySeries.get(SERIES_IDS.unemployment)?.value ?? null,
      payrollsMoMThousands: payrollObservation && priorPayrolls !== null ? payrollObservation.value - priorPayrolls : null,
      seriesCoverage,
    };
  } catch {
    return unavailable();
  }
}

function findPriorObservation(
  observations: readonly MacroSeriesObservation[],
  seriesId: string,
  latestTimestamp: number | null,
  daysBack: number
): number | null {
  if (latestTimestamp === null) return null;
  const target = latestTimestamp - daysBack * 24 * 60 * 60 * 1000;
  return observations
    .filter(item => item.seriesId === seriesId && item.observedAt <= target)
    .sort((a, b) => b.observedAt - a.observedAt)[0]?.value ?? null;
}

function isMacroObservation(value: unknown): value is MacroSeriesObservation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.seriesId === 'string' &&
    Number.isFinite(candidate.observedAt) &&
    Number.isFinite(candidate.value) &&
    candidate.source === MACRO_SOURCE;
}
