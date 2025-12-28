# Phase 9: Scoring Calibration + Deterministic Ranking

## Goal
Ensure stable, repeatable ranking across backends and allow tuning of BM25 parameters.

## Changes
- Tie-break sorting in BM25/ANN to stabilize result order.
- Optional BM25 parameters via config (`search.bm25.k1`, `search.bm25.b`).

## Usage
```json
{
  "search": {
    "bm25": { "k1": 1.2, "b": 0.75 }
  }
}
```

## Notes
- FTS5 scores are not numerically comparable to custom BM25.
- Use the parity harness to verify top-N overlap after tuning.
