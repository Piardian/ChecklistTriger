# Checklist Trigger Benchmark Protocol

## Reproduce the 15M vs 1M comparison

Run from the repository root after dependencies are installed:

```bash
npm ci
npm run typecheck
npm test
npm run build
npx ts-node server/runClt1mUnicornBenchmark.ts
```

The benchmark reads local candle JSON files under `data/`; it skips symbols for which any required timeframe file is missing. Record the exact commit SHA, candle file hashes/date ranges, and the output alongside any performance claim.

## Interpretation rules

- The 15M win rate denominator is now resolved 15M outcomes, not all candidate signals. Unresolved outcomes are reported separately.
- The 1M comparison reports confirmed fills, veto/no-entry cases, resolved fills, and time exits separately.
- A veto/no-entry is not a realized win or loss and must not be included in realized PnL.
- The benchmark's TP/BE/SL assumptions are simplified outcomes, not a broker fill simulation. Before using it to establish edge, validate timestamp semantics, intrabar ordering when SL and TP can both be touched, spread/slippage/commission, and candle data coverage.
- The script is a research benchmark only. It does not authorize or change live execution.

## CI evidence

A source edit is not a test result. A change is validated only when the actual typecheck, unit-test, build, and benchmark command output is retained. Do not mark this work complete from a code review alone.
