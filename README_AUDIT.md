# README audit (temporary)

Date: 2026-01-26

Purpose
- Catalog README items that are out of date or should be rewritten.
- Provide a rewrite outline and the simplified README explainer (ASCII draft).
- Plan moving the current README diagrams into docs/guides/architecture.md and splitting them into narrower, more detailed diagrams.

---

## Out of date or inconsistent items

1) Build index mode list is stale
- README: "--mode code|prose|both" under Build index.
- Actual: build uses code|prose|extracted-prose|records|all (see src/shared/cli-options.js).
- Action: update README and examples to list valid modes.

2) Search mode default is not "both"
- README: implies --mode both is default in many workflows.
- Actual default: code + prose + extracted-prose (see src/retrieval/cli-args.js resolveSearchMode).
- Action: update README to describe default correctly.

3) Backend list vs CLI wrapper mismatch
- README: lists sqlite-fts as a backend.
- Wrapper (bin/pairofcleats.js) rejects --backend sqlite-fts; allows auto|sqlite|lmdb only.
- Underlying search supports sqlite-fts (see docs/contracts/search-cli.md and src/storage/backend-policy.js).
- Action: either update wrapper to allow sqlite-fts or update README to say sqlite-fts is only available via node search.js or config.

4) Sparse vs ANN backend is conflated
- README: "Optional performance backends (auto-selected when available): LMDB, LanceDB, SQLite ANN extension. Set explicit config to force a backend."
- Actual model: sparse backend (memory/sqlite/sqlite-fts/lmdb/tantivy) and ANN backend (auto/lancedb/sqlite-vector/hnsw/js) are separate (see docs/contracts/search-cli.md, src/retrieval/cli.js).
- Action: rewrite to explain sparse backend vs ANN backend and point to the right flags/config.

5) Auto backend selection description is too vague
- README: "auto picks the best available backend based on index size + installed deps."
- Actual behavior: auto selection depends on default backend (AutoPolicy) and index availability (see src/storage/backend-policy.js and src/retrieval/cli/auto-sqlite.js).
- Action: clarify what auto actually considers; avoid implying dependency probing if it is not implemented.

6) Doc extraction env var is not present
- README: mentions PAIROFCLEATS_DOC_EXTRACT=on.
- Code/config: only indexing.documentExtraction.enabled is wired (no env var found).
- Action: remove env var reference or implement it.

7) Status section is stale
- README: "Phase 3 specs (current correctness work)".
- Current roadmap is Phase 6-10 work (see GIGAROADMAP.md).
- Action: replace with a single pointer to GIGAROADMAP.md or update to the current phase.

8) Query syntax section is too narrow
- README: only covers phrases and exclusion.
- Search CLI supports mode filters, lang/ext/path/meta/risk filters, and structural filters (see docs/contracts/search-cli.md, docs/guides/search.md).
- Action: expand or link to the full search guide and CLI contract.

9) Diagrams are too detailed for README
- README: full indexing and search pipelines.
- Action: move spec-accurate diagrams to docs/guides/architecture.md and replace README with a simplified high-level explainer.

---

## Needs rewrite or clarification (even if mostly correct)

- "What this is" section is long and mixes marketing with technical details. Split into a short elevator pitch + concise capability bullets.
- "Why it exists" repeats points and could be tightened into a short contrast table.
- Requirements section mixes optional backends and features; should group into: required, optional for scale, optional for ANN, optional for doc extraction.
- Quick start mixes CLI, scripts, and config details; should separate user flows: setup, build, search, service.
- Backends section should be rewritten into: sparse backend selection, ANN backend selection, and when each is used.
- Cache section should confirm actual paths and provide a single canonical path pattern from dict-utils.
- Search examples should include one filters example (lang/ext/path) and one explain example.

---

## Diagram relocation plan (docs/guides/architecture.md)

Move both current README diagrams into docs/guides/architecture.md and split into narrower, more detailed diagrams:

Indexing diagrams (split into 3 to 4):
1) Discovery and sharding
- repo scan, ignore rules, mode selection, shard planner output
2) Foreground build pipeline
- tokenize/quantize/imports, postings/chargrams, file cache reuse
3) Artifact write and SQLite build
- chunk_meta, postings, bundles, SQLite tables, index state
4) Background enrichment
- tree-sitter, embeddings, risk/lint metadata, vector artifacts, sqlite ANN tables

Search diagrams (split into 3):
1) Query parsing and filters
- parse, tokenization by mode, filter prefilter, metadata filtering
2) Candidate selection and ranking
- sparse (BM25/FTS) and dense (ANN) lanes, fuse/rrf/blend
3) Output and context
- context expansion, result shaping (human vs JSON), stats

Also add a small diagram for backend selection:
- sparse backend choice (memory/sqlite/sqlite-fts/lmdb/tantivy)
- ANN backend choice (sqlite-vector/hnsw/lancedb/js)

---

## README rewrite outline

1) Title and short one-line description
2) What it does (3 to 5 bullets)
3) Quick start (setup, build, search)
4) Simple mental model (high-level ASCII diagram + brief explanation)
5) Requirements (required + optional groups)
6) Common commands (search, build, watch, service)
7) Links to deeper docs (search guide, setup, config, architecture)
8) Status (link to GIGAROADMAP.md only)

---

## Simplified high-level explainer (ASCII draft)

PairOfCleats does two things: builds an index, then searches it.

Index:
  repo files -> parse + chunk -> store artifacts (disk/sqlite)

Search:
  query -> filters + rank -> top chunks -> output

Draft ASCII (for later Mermaid):

  [Repo] -> [Index build] -> [Artifacts / SQLite]
                    
  [Query] -> [Search pipeline] -> [Ranked chunks]

Notes:
- Keep README diagram as this simple draft only.
- Move all detailed diagrams to docs/guides/architecture.md.

---

## Rewrite checklist (for the actual rewrite)

- Update build and search mode lists.
- Align backend choices with CLI wrapper and search contract.
- Remove or fix PAIROFCLEATS_DOC_EXTRACT.
- Replace Phase 3 status block with a single roadmap link.
- Replace detailed diagrams with the ASCII draft above.
- Add link to docs/guides/architecture.md.
