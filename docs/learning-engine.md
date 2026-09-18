# Learning Engine

Sprint 6 introduces an evidence-based learning layer for Swing BOS Core.

The Learning Engine is not AI, not an LLM, not a prediction engine, and not a Decision Engine. It converts historical segmented benchmark evidence into deterministic observations and explainable patterns.

## Data Flow

```text
Validated historical signal + outcome evidence
        ↓
Deterministic time split + leakage purge
        ↓
Training SegmentedBenchmarkReport
        ↓
Observation Engine
        ↓
Learning Observations
        ↓
Pattern Detector
        ↓
LearningReport
        ↓
Separate out-of-sample benchmark
        ↓
Out-of-sample pattern validation
```

## Public API

```ts
generateLearningReport(segmentedBenchmarkReport): LearningReport
```

The historical orchestration layer is exposed separately through `generateHistoricalLearningReport(...)` and is responsible for dataset loading, temporal splitting, and OOS validation.

## Architectural Boundary

The Learning Engine only reads `SegmentedBenchmarkReport`.

It does not:

- read snapshots or outcomes;
- validate datasets;
- calculate benchmarks;
- change grades;
- filter signals;
- write to Telegram;
- make trade recommendations.

Historical orchestration performs those upstream responsibilities before data reaches the Learning Engine.

## Training vs Out-of-Sample

Historical learning uses a deterministic chronological split. The default is approximately 70% training and 30% out-of-sample.

Training observations whose realized outcome extends into the out-of-sample period are purged. This prevents future outcome information from leaking into the training sample.

The out-of-sample period is never used to create the learned pattern. It is only used afterward to test whether the observed direction is reproduced on unseen future observations.

An out-of-sample result labelled `VALIDATED` means only that the historical direction was reproduced with the configured minimum sample size. It is not a claim of causality, profitability, or statistical significance.

## Observation vs Pattern

An observation is a direct segment-vs-overall comparison.

Example:

```text
grade:A+ TPRate is above overall benchmark.
```

A pattern is a deterministic interpretation of one or more observations.

Example:

```text
grade:A+ shows PERFORMANCE_ADVANTAGE on TPRate versus the overall historical benchmark.
```

Every pattern remains traceable to its source observation and benchmark fingerprint.

## Eligibility Rules

Learning is skipped unless evidence quality is sufficient:

```text
sampleSize >= 30
coverage >= 0.80
belowRecommendedSample == false
```

Segments that do not satisfy these rules produce typed warnings instead of patterns.

## Confidence and Statistical Uncertainty

`confidence` is an evidence-quality heuristic based on sample size and coverage. It is explicitly labelled with the method `HEURISTIC_SAMPLE_COVERAGE` and must not be interpreted as the probability that a pattern will work in the future.

For binary rate metrics (`TPRate` and `SLRate`), the pattern also carries a 95% Wilson binomial interval. This interval describes uncertainty around the observed segment rate; it is not a causal significance test and it does not compare two independent proportions.

The definitive guard against overfitting is therefore the chronological out-of-sample check, not the heuristic confidence field.

## Explainability

Every observation and pattern includes:

- segment metric;
- overall benchmark metric;
- difference;
- sample size;
- coverage;
- dataset fingerprint;
- benchmark version.

`summary` is for humans. `explanation` is structured for UI, audits, and future agents.

## Non-goals

Learning does not act.

```text
Benchmark → Describe
Learning  → Infer
Decision  → Act
```

Historical learning remains an offline research process. Runtime admission evaluates the current candidate directly and does not fabricate historical TPRate, sample size, coverage, or confidence values.
