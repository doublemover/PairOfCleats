# Metrics Dashboard

## Goal
Provide a fast console summary of indexing and search metrics, with optional JSON output for external dashboards.

## Usage
- `pairofcleats report metrics`
- `pairofcleats report metrics --json`
- `pairofcleats report metrics --out metrics-summary.json`
- `pairofcleats report metrics --top 10`
- `pairofcleats report metrics --repo /path/to/repo`

`--top` controls the top queries/files/terms list size (default: 5).

## Summary Fields
- Index metrics: chunk/token totals for code and prose indexes.
- Search history: total queries, average latency (ms), last query timestamp, no-result count, top queries.
- Top files (by hit counts) and top terms (by frequency in metrics entries).

JSON payload keys:
- `generatedAt`, `metricsDir`
- `index` (code/prose index metrics)
- `search` (totalQueries, avgMs, lastQueryAt, noResultCount, topQueries)
- `files.topHits`, `terms.top`

## Inputs
- `<repoCacheRoot>/metrics/index-code.json` (index build metrics)
- `<repoCacheRoot>/metrics/index-prose.json` (index build metrics)
- `<repoCacheRoot>/metrics/metrics.json` (file hit + term lists)
- `<repoCacheRoot>/metrics/searchHistory` (JSONL)
- `<repoCacheRoot>/metrics/noResultQueries` (JSONL)
