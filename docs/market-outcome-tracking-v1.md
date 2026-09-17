# Market Outcome Tracking V1

## Purpose

Market Outcome Tracking V1 converts an approved signal into a deterministic forward-market outcome using only subsequent completed 15M OHLC candles.

It is a research/evidence component. It does not place broker orders and does not claim that the simulated entry/stop/target were actually executed.

## Evaluation Plan

For every approved signal:

- Entry: midpoint of the POI zone.
- Stop: one pip-size unit beyond the invalidation side of the POI.
- Target: 2R from the research entry.
- Entry window: 16 completed 15M candles by default.
- Maximum holding window after entry: 32 completed 15M candles by default.
- Entry candle exclusion: the candle that first touches the research entry is used only to establish entry timing; TP/SL and MFE/MAE are evaluated from the next completed 15M candle onward.
- Same-candle ambiguity: STOP_LOSS_FIRST for post-entry candles because OHLC data cannot establish the intrabar order of target and stop touches.

All parameters can be overridden by `OutcomeTrackerOptions`.

## Data Boundary

The first candle eligible for outcome evaluation must have a timestamp strictly greater than the signal's `validationCloseTimestamp`, then `marketDataTimestamp`, then structure event timestamp.

Therefore the signal's own analysis candle is never reused as future evidence. The entry candle is also not used to infer post-entry path-dependent events because OHLC cannot reveal whether the stop or target was reached before or after the entry touch.

## Terminal Outcomes

- `TAKE_PROFIT`: target was reached before the stop on a post-entry candle.
- `STOP_LOSS`: stop was reached before the target on a post-entry candle.
- `EXPIRED`: entry was not reached within the entry window, or the maximum holding window elapsed after entry.
- `OPEN`: entry was triggered but the maximum holding window has not elapsed and neither terminal level was reached yet.
- `WAITING_ENTRY`: insufficient future candles exist to determine entry-window expiry.

## Evidence

Completed outcomes are appended to `evidence/outcomes/outcome-evidence.jsonl` using the existing append-only evidence writer.

Recorded metrics include holding time, realized research R multiple, maximum favorable excursion, maximum adverse excursion, exit timestamp and exit reason.

## Persistence

Active outcome tracking state is persisted to `data/active_outcomes.json` by default. A custom location can be supplied with `OUTCOME_TRACKER_STATE_FILE`.

## Important Limitation

The evaluation plan is an explicit research convention, not the strategy's broker execution plan. Future benchmark work should compare this standardized plan with the actual intended execution model before using outcome data for calibration or learning.
