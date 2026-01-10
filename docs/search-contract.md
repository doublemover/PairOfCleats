# Search contract

This document defines the expected search semantics across backends and modes.
It is the correctness reference for the search pipeline.

## Ranking components

Search uses a blended ranking model:
- **Sparse (BM25)** over token postings.
- **Dense similarity** over embedding vectors (when enabled).
- **Minhash similarity** for near-duplicate signals.
- **Symbol boosts** for definitions/exports (configurable).
- **Field weights** for name/signature/doc/comment/body.

When both sparse and dense are enabled, results are blended using RRF or a
weighted sum depending on config (`search.rrf`, `search.scoreBlend`).

## Filters and precedence

Filters are applied before ranking. Supported filters include:
- `--lang`, `--ext`, `--file`, `--path`, `--kind`, `--signature`
- `--risk`, `--risk-tag`, `--risk-source`, `--risk-sink`, `--risk-category`, `--risk-flow`
- `--inferred-type`, `--return-type`, `--param`, `--uses`, `--calls`

Filters are ANDed together unless explicitly documented otherwise.

## Multi-mode fusion

Search supports code, prose, records, and mixed modes. Mixed-mode results are
fused using RRF by default; each mode can be weighted independently via config.

## Explain schema

`--explain` emits a stable `scoreBreakdown` object for each hit:
- `selected.score`: final score used for ranking
- `sparse.score`: BM25 score (if available)
- `dense.score`: embedding similarity (if available)
- `rrf.score`: RRF contribution when enabled
- `boosts`: symbol/metadata boosts applied
- `filters`: include/exclude decisions and reasons

Backends must emit this schema consistently so that parity checks are meaningful.
