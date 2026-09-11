# ChecklistTrigger Documentation Index

Welcome to the technical documentation repository for **ChecklistTrigger**. This directory contains detailed contracts, architecture specifications, benchmark methodologies, and audit logs.

---

## 📑 Table of Contents

- [1. Architecture & Core Engines](#1-architecture--core-engines)
- [2. Contracts & Interface Specifications](#2-contracts--interface-specifications)
- [3. Intelligence & Learning Pipeline](#3-intelligence--learning-pipeline)
- [4. Execution & Simulation](#4-execution--simulation)
- [5. Telemetry, Delivery & Visualization](#5-telemetry-delivery--visualization)
- [6. Audits, Journals & Milestones](#6-audits-journals--milestones)

---

## 1. Architecture & Core Engines

These documents explain the primary analytical engines governing market-structure evaluation, risk constraints, and benchmarking:

- **[Decision Engine](./decision-engine.md)** — Evaluates candidate setups against operational policy.
- **[Risk Engine](./risk-engine.md)** — Defines portfolio and setup risk evaluation, lifecycle, and limits.
- **[Benchmark Engine](./benchmark-engine.md)** & **[Segmented Benchmark](./segmented-benchmark.md)** — Deterministic performance and regression benchmark suite.
- **[Signal Quality Engine](./signal-quality-engine.md)** — Scorer and validation gate for setups (displacement, grade points).
- **[Outcome Engine](./outcome-engine.md)** — Measures post-signal trade progression (MFE, MAE, mitigation status).

---

## 2. Contracts & Interface Specifications

Formal specifications ensuring consistent behavior across system boundaries:

- **[Detector Contract v1.0](./detector-contract-v1.0.md)** — Requirements for swing, BOS, CHoCH, OB, and FVG detectors.
- **[Signal Delivery Contract v1.0](./signal-delivery-contract-v1.0.md)** — Delivery payload format, retry mechanisms, and rate limits.
- **[Execution Eligibility Contract v1.0](./execution-eligibility-contract-v1.0.md)** — Qualification criteria before an alert transitions to execution readiness.
- **[Setup Intelligence Contract v2.0](./setup-intelligence-contract-v2.md)** — Metadata structure for enriched candidate context.

---

## 3. Intelligence & Learning Pipeline

Modules dedicated to pattern discovery, historical replays, and evidence collection:

- **[Intelligence Pipeline](./intelligence-pipeline.md)** — End-to-end telemetry and learning analysis.
- **[Learning Engine](./learning-engine.md)** & **[Learning Observation Foundation](./learning-observation-foundation.md)** — Captures setup observations across time.
- **[Pattern Discovery Foundation](./pattern-discovery-foundation.md)** — Identifies repeated structural behaviors.
- **[Hypothesis Generation](./hypothesis-generation-foundation.md)** & **[Recommendation Foundation](./recommendation-foundation.md)** — Automated insight generation.
- **[Historical Replay Foundation](./historical-replay-foundation.md)** & **[Historical Dataset Validation](./historical-dataset-validation.md)** — Deterministic backtesting and replay engine.
- **[Evidence Collection Engine](./evidence-collection-engine.md)** & **[Signal Evidence Recorder (EVR 1.0)](./evr-1.0-signal-evidence-recorder.md)** — Auditable recording of market state.

---

## 4. Execution & Simulation

Runtime lifecycle, state machines, and paper execution:

- **[Execution Engine](./execution-engine.md)** & **[Execution Runtime](./execution-runtime.md)** — Session orchestration and order lifecycle.
- **[Execution Planning](./execution-planning.md)** & **[Execution Session](./execution-session.md)** — Step-by-step order preparation.
- **[Paper Execution](./paper-execution.md)** — Virtual order tracking and simulated fill model.
- **[Simulation Execution](./simulation-execution.md)** — Multi-scenario synthetic trade simulation.

---

## 5. Telemetry, Delivery & Visualization

Grafik üretimi, Telegram entegrasyonu ve kuyruk yönetimi:

- **[Provider Queue (TDQ 1.0)](./tdq-1.0-provider-queue.md)** — TwelveData API queueing and rate-limit guard.
- **[Live Operational Telemetry (PQ 1.1)](./pq-1.1-live-operational-telemetry.md)** — Runtime health, heartbeat, and queue metrics.
- **[Overlay Renderer](./overlay-renderer.md)** & **[Visualization Overlays](./rc5-visualization-review-overlay.md)** — Canvas and TradingView overlay generation.
- **[Notification Delivery Reliability](./rc5.3.1-notification-delivery-reliability.md)** — Resilient delivery over Telegram bot gateways.
- **[Multi-timeframe Overlay](./rc5.1-multitimeframe-overlay.md)** & **[4H Chart Attachments](./rc5.8-4h-chart-attachments.md)** — Visual chart generation for multi-timeframe confirmation.

---

## 6. Audits, Journals & Milestones

Real-world reviews, mathematical validations, and phased milestones:

- **[SMC Trade Journal](./SMC_JOURNAL.md)** — Observational autopsy log analyzing real-world Telegram signals, liquidity traps, and false setups.
- **[Mathematical Audit Report](./audit/SMC_MATHEMATICAL_AUDIT_REPORT.md)** — Mathematical audit of Fib ratios, epsilon precision, and structural rules.
- **[Phase 10 Milestone Specification](./milestones/FAZ10_v2.md)** — Historical architecture milestone notes.
