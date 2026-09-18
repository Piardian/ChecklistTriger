export const WILSON_INTERVAL_METHOD = 'WILSON_BINOMIAL_95' as const;

export interface WilsonInterval {
  method: typeof WILSON_INTERVAL_METHOD;
  confidenceLevel: 0.95;
  successCount: number;
  trialCount: number;
  estimate: number;
  lower: number;
  upper: number;
}

const Z_95 = 1.959963984540054;

export function calculateWilsonInterval(successCount: number, trialCount: number): WilsonInterval | undefined {
  if (!Number.isInteger(successCount) || !Number.isInteger(trialCount) || trialCount <= 0) return undefined;
  if (successCount < 0 || successCount > trialCount) return undefined;

  const n = trialCount;
  const p = successCount / n;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;

  return Object.freeze({
    method: WILSON_INTERVAL_METHOD,
    confidenceLevel: 0.95,
    successCount,
    trialCount,
    estimate: round(p),
    lower: round(Math.max(0, center - margin)),
    upper: round(Math.min(1, center + margin)),
  });
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
