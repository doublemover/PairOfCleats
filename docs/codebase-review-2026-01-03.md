# Codebase Review (2026-01-03)

This document tracks correctness-first findings and fixes during a systematic review of the codebase. Each section records verified issues, decisions, and follow-ups.

## Indexing

Correctness fixes:
- `build_index.js` now resolves `tools/build-sqlite-index.js` from the install root so tests running under a temp repo can still build SQLite artifacts.
- SQLite ingestion now resolves `file_meta.json` when `chunk_meta.json` stores `fileId` only, so `file_manifest` entries (and external docs) are correctly populated.

Open items:
- None in this pass.

## Search + Scoring

Correctness fixes:
- Added a minhash parity test to ensure search and indexing signatures stay compatible.

Open items:
- None in this pass.

## SQLite

Correctness fixes:
- File-level metadata for SQLite ingestion now uses `file_meta.json` so `file_manifest` entries exist even when chunk metadata omits `file`.

Open items:
- None in this pass.

## Tooling + Utilities

Correctness fixes:
- None in this pass.

Open items:
- Reviewed tooling/utility scripts; no correctness issues found in this pass.

## Language Handlers

Correctness fixes:
- Added a fast `require()` scan to the JS import pass so CJS imports contribute to `importLinks` without a full AST pass.

Open items:
- None in this pass.

## Shared Core Utilities

Correctness fixes:
- None in this pass.

Open items:
- Reviewed shared utilities; no correctness issues found in this pass.
