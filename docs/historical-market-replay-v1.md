# Historical Market Replay V1

Historical Market Replay is the candle-level research layer. It is separate from the existing Historical Replay Foundation.

## Existing Historical Replay Foundation

The existing `historicalReplay.ts` replays already-created `SignalRecord` objects through the Intelligence Pipeline.

```text
SignalRepository
    ↓
Historical Signal Replay
    ↓
Intelligence Pipeline
```

It does not regenerate Signals from historical market candles and does not calculate outcomes from future candles.

## Historical Market Replay V1

V1 replays a historical 15M candle stream chronologically. At each replay timestamp it exposes only candles at or before that timestamp through a replay-local `CandleStore`.

```text
Historical Candle Dataset
    ↓
Replay Cursor
    ↓
15M / 1H / 4H candles available only up to cursor
    ↓
Existing `runPipeline`
    ↓
New candidate(s)
    ↓
Existing deterministic `evaluateOutcome`
    ↓
TP / SL / EXPIRED / UNRESOLVED
```

## Causality rule

Candidate generation cannot read candles after the current replay timestamp.

A candidate whose validation or market-data timestamp is later than the replay timestamp is rejected as a replay invariant violation.

Outcome evaluation begins strictly after the candidate's validation-close timestamp. The outcome evaluator therefore cannot use the candle that established the entry touch to decide whether TP or SL happened first.

## Multi-timeframe rule

15M is the replay clock. 1H and 4H datasets are sliced independently to candles whose timestamp is less than or equal to the current 15M replay timestamp.

No forward 1H or 4H candles are exposed to the current step.

## Market-window rule

By default, V1 respects the existing hard market window and killzone configuration using the historical candle timestamp rather than the machine's current clock.

Both controls can be disabled explicitly for research fixtures through `respectMarketWindow` and `respectKillzone`.

## Duplicate handling

The replay uses an in-memory notification store. A candidate's `uniqueKey` and `dedupeKey` are remembered once discovered so the same POI is not emitted on every subsequent 15M candle.

No production `data/notified_pois.json` file is modified.

## Outcome handling

V1 reuses the deterministic research outcome evaluator already used by runtime outcome tracking. The research defaults remain explicit:

- entry = POI midpoint
- invalidation buffer = 1 pip-size unit
- target = 2R
- default entry window = 16 completed 15M candles
- default maximum hold = 32 completed 15M candles
- same-candle TP/SL ambiguity = `STOP_LOSS_FIRST`

An outcome is `UNRESOLVED` when the replay dataset ends before the configured evaluation window can be completed. V1 does not invent a terminal outcome in that case.

## Side effects

The replay does not write repository records, outcomes, benchmarks, notifications, or telemetry. Production telemetry is disabled around the synchronous `runPipeline` call so the research pass does not contaminate operational telemetry files.

The engine does not submit broker orders and does not claim to model real execution costs such as spread, slippage, latency, or partial fills.

## Current scope limitation

V1 reuses the existing candidate-generation pipeline. It does not yet replay downstream notification validation, execution/risk policy, or broker execution. Therefore a V1 candidate is a strategy-pipeline candidate, not proof that the live notification or execution path would have accepted the same setup.

This limitation is intentional. The first objective is to establish candle causality and deterministic market-outcome measurement before adding execution-layer replay.
