# Architecture diagrams

This document holds detailed system diagrams. The README only keeps a simplified, high-level explainer.
Update these diagrams when the pipeline changes.

## Path handling

See `docs/guides/path-handling.md` for the canonical path policy used across indexing and tooling.

## Indexing (build)

### 0) Runtime + config resolution

```mermaid
graph TD
  A["CLI args + env"] --> B["Load user config"]
  B --> C["AutoPolicy derivation"]
  C --> D["Runtime envelope"]
  D --> E["Build plan (modes, caps, stages)"]
  E --> F["Discovery"]
```

References:
- docs/config/contract.md
- docs/config/hard-cut.md
- docs/specs/runtime-envelope.md

### 1) Discovery and Stage1 sequencing

```mermaid
graph TD
  A["Repo root"] --> B["Discovery + ignore rules"]
  B --> C["Mode classification (code/prose/extracted-prose/records)"]
  C --> D["Global seq assignment (immutable)"]
  D --> E["Contiguous window planner"]
  E --> F["Active window set (W0 commit, W1 compute prefetch)"]
```

References:
- docs/contracts/indexing.md
- docs/guides/triage-records.md
- docs/specs/stage1-order-contiguous-runtime.md
- docs/specs/stage1-window-planner.md

### 2) Foreground build pipeline

```mermaid
graph TD
  A["Active windows"] --> B["Compute lane (parallel)"]
  B --> C["Result envelopes by seq"]
  C --> D["Commit lane (nextCommitSeq only)"]
  D --> E["Contiguous commit micro-batches"]
  E --> F["Sparse index (tokens + postings + chargrams)"]
  F --> G["Filter index (path/lang/meta)"]
```

References:
- docs/contracts/indexing.md
- docs/language/import-links.md
- docs/guides/search.md
- docs/specs/stage1-order-contiguous-runtime.md
- docs/specs/stage1-backpressure-controller.md

### 3) Artifacts and SQLite build

```mermaid
graph TD
  S["Sparse index"] --> G["Artifacts (chunk_meta, postings, bundles, filter index)"]
  S --> H["SQLite build (WAL + bulk tx)"]
  G --> I["Manifest + build_state"]
  H --> I
```

References:
- docs/contracts/public-artifact-surface.md
- docs/contracts/sqlite.md
- docs/sqlite/index-schema.md

### 4) Background enrichment

```mermaid
graph TD
  G["Artifacts"] --> Q["Enrichment queue"]
  Q --> J["Tree-sitter + lint + risk + embeddings"]
  J --> K["Enriched artifacts + vectors"]
  K --> H["SQLite update (dense vectors, ANN tables)"]
```

References:
- docs/contracts/indexing.md
- docs/guides/embeddings.md
- docs/sqlite/ann-extension.md

### 5) Build promotion and current pointer

```mermaid
graph TD
  A["Attempt build root"] --> B["Validate artifacts"]
  B --> C{Valid?}
  C -->|yes| D["Promote current.json"]
  C -->|no| E["Keep previous current"]
```

References:
- docs/specs/watch-atomicity.md
- docs/specs/build-state-integrity.md

## Search (query)

### 0) CLI parse and mode resolution

```mermaid
graph TD
  A["CLI args"] --> B["Parse + validate"]
  B --> C["Resolve mode + filters"]
  C --> D["Policy + backend selection"]
```

References:
- docs/contracts/search-cli.md
- docs/guides/search.md

### 1) Query parsing and filters

```mermaid
graph TD
  Q["Query string"] --> P["Parse terms + phrases"]
  P --> T["Tokenize by mode"]
  T --> F["Filter plan (path/lang/meta/risk)"]
  F --> C["Candidate prefilter (chargrams)"]
```

References:
- docs/contracts/search-contract.md
- docs/guides/search.md

### 2) Ranking and fusion

```mermaid
graph TD
  C["Candidate set"] --> S["Sparse rank (BM25 or sqlite-fts)"]
  C --> D["Dense rank (ANN: sqlite-vector/hnsw/lancedb/js)"]
  S --> M["Fusion (RRF or blend) + boosts"]
  D --> M
```

References:
- docs/contracts/retrieval-ranking.md
- docs/guides/search.md
- docs/guides/embeddings.md

### 3) Output and context

```mermaid
graph TD
  M["Fused results"] --> X["Context expansion (imports/calls/related)"]
  X --> O["Output shaping (human/JSON) + stats"]
```

References:
- docs/contracts/search-contract.md
- docs/guides/search.md

### 4) Query cache

```mermaid
graph TD
  A["Query + filters"] --> B{Cache hit?}
  B -->|yes| C["Return cached results"]
  B -->|no| D["Execute search"]
  D --> E["Store cache entry"]
```

References:
- docs/guides/query-cache.md

## Backend selection

### Sparse backend choice

```mermaid
graph TD
  A["Backend flag (--backend) or auto policy"] --> B{Backend available?}
  B --> C["memory"]
  B --> D["sqlite"]
  B --> E["sqlite-fts"]
  B --> F["lmdb"]
  B --> G["tantivy"]
```

References:
- docs/contracts/search-cli.md
- docs/contracts/sqlite.md
- docs/guides/external-backends.md

### ANN backend choice

```mermaid
graph TD
  A["ANN enabled?"] --> B{Backend available?}
  B --> C["sqlite-vector"]
  B --> D["hnsw"]
  B --> E["lancedb"]
  B --> F["js fallback"]
```

References:
- docs/contracts/search-cli.md
- docs/sqlite/ann-extension.md
- docs/guides/external-backends.md

