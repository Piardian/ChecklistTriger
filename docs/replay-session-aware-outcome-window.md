# Replay Session-Aware Outcome Window

Historical market replay evaluates a signal only against future 15M candles, but the evaluation window must not expire merely because non-trading calendar time passes. In particular, a Friday signal should not consume Saturday/Sunday as active 15M bars.

The production baseline remains unchanged. This document defines the research requirement for a session-aware outcome evaluator.

## Required semantics

- Entry-window and max-hold counters advance only on valid market-data bars for the instrument.
- Weekend gaps and missing bars do not consume outcome bars.
- The evaluator remains causal: only candles with timestamps strictly greater than the signal observation timestamp are eligible.
- The actual number of evaluated market bars is recorded in evidence.
- Calendar elapsed time and market-bar elapsed time are separate fields.
- No automatic change to the production 16-bar baseline should be made from this research requirement alone.

## Research matrix

For EURUSD, compare:

1. 16 market bars / midpoint
2. 32 market bars / midpoint
3. 48 market bars / midpoint
4. 80 market bars / zone touch

The purpose is to determine whether the observed Friday-to-Monday expiry is a calendar-window artifact or an actual entry failure.
