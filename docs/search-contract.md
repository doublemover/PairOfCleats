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

Filter ordering and top semantics:
- File/path prefilters (chargram/regex) only narrow candidates; the final exact filter always runs.
- Metadata filters are evaluated before ranking, and the allowed IDs gate sparse + ANN ranking.
- `--top` applies after ranking/fusion within each mode; the pipeline over-fetches to improve fulfillment but returns fewer results when filters or candidate sets are too small.
- Context expansion runs after the primary top-N selection and may append extra context hits when enabled.

Filters are ANDed together unless explicitly documented otherwise.

## Multi-mode fusion

Search supports code, prose, records, and mixed modes. Mixed-mode results are
fused using RRF by default; each mode can be weighted independently via config.

## Explain schema

`--explain` emits a stable `scoreBreakdown` object for each hit:
- `selected`: `{ type, score }` final score selection
- `sparse`: BM25/FTS score + weighting metadata (when available)
- `ann`: `{ score, source }` dense similarity (when available)
- `rrf`: rank fusion details when enabled
- `blend`: normalized blend details when enabled
- `symbol`: definition/export boost metadata
- `phrase`: phrase/chargram boost metadata

Backends must emit this schema consistently so that parity checks are meaningful.
