# Replay Session-Aware Outcome Evaluation

## Purpose

Historical market replay must distinguish elapsed wall-clock time from completed market bars. A weekend or other market-data gap must not consume an entry or holding window merely because timestamps are farther apart.

## Research rule

For replay research, entry and holding windows are measured in eligible completed 15M candles, not calendar time. Candles are evaluated only when they exist in the historical dataset and are strictly after the candidate observation timestamp.

The production defaults remain unchanged: 16 entry-window bars, 32 maximum-hold bars, midpoint entry, and 2R target. Session-aware handling is a replay methodology correction, not a production strategy change.

## Required validation

EURUSD must be rerun after the session-aware implementation for the existing sensitivity matrix: 16/32/48 midpoint and the zone-touch diagnostic. The Friday-to-Monday Signal #10 case is the regression case: its result must no longer depend on counting the weekend as market bars.

Only after this validation passes should the same replay procedure be expanded to the 27-instrument dataset.

## Non-goals

This change does not model broker spread, slippage, latency, partial fills, or the live 1M CHoCH/retest confirmation layer. Those remain separate research dimensions.
