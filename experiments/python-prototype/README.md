# Python Prototype & SMC Analysis Experiments

This directory contains early-stage prototype scripts, CLI utilities, and mathematical verification tests developed during the initial architectural validation of the Smart Money Concepts (SMC) engine.

## Contents
- `api/routers/smc_analysis.py`: FastAPI experimental router for mock SMC analysis requests.
- `cli/main.py`: Click-based CLI entry point for rapid symbol analysis tests.
- `requirements.txt`: Python package dependencies (`fastapi`, `uvicorn`, `click`, `pytest`, `pydantic`).
- `test_smc_math.py`: Pytest cases verifying mathematical concepts (Premium/Discount Fib ratios, BOS/CHoCH price break conditions).

## Note
The active production engine is implemented in TypeScript / Node.js under `/src` and `/server`.
