# ChecklistTrigger — Market Structure Analysis Engine

A TypeScript/Node.js event-driven market-analysis engine for EUR/USD and GBP/USD. The system combines market-structure detection, price-action concepts, quality scoring, persistence, scheduled data polling, and Telegram delivery.

## Pipeline

```text
Twelve Data API
      ↓
Candle Poller
      ↓
Candle Store
      ↓
Market Structure Analysis
      ↓
POI / Model Evaluation
      ↓
Grade Calculation
      ↓
Candidate Opportunity
      ↓
Telegram Notification
```

## Analysis components

The current engine includes implementations for:

- Swing detection
- BOS / CHoCH
- Range detection
- Liquidity sweep detection
- Order Blocks
- Fair Value Gaps
- Premium / Discount classification
- Displacement quality scoring
- POI test tracking
- Model determination
- Grade calculation

## Runtime components

- `server/twelveDataClient.ts` — Twelve Data market-data client
- `server/poller.ts` — scheduled data acquisition and pipeline orchestration
- `server/index.ts` — runtime startup, scheduling, and health endpoint
- `src/` — analysis and domain logic
- `tests/` — automated validation

The runtime uses different polling intervals for 15m, 1h, and 4h data and performs a controlled cold start to avoid unnecessary API pressure.

## Development

```bash
npm install
npm test
npm run build
```

The service exposes `GET /health` for deployment/runtime health checks.

## Engineering focus

This project is primarily an engineering exercise in deterministic market-data processing and event-driven automation. The objective is to make the analysis pipeline explicit, testable, and observable rather than hide the logic behind a single monolithic script.

## Status

**Active development / research prototype.**

The analysis outputs are experimental and are not financial advice or a claim of predictive trading performance.
