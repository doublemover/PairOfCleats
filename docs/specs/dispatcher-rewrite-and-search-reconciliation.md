# Dispatcher rewrite + Search flags reconciliation spec — v1

## Status
- **Spec version:** 1
- **Audience:** PairOfCleats contributors maintaining the TUI + Node supervisor boundary
- **Implementation status:** active / implemented for search flag pass-through and opt-in strict dispatch validation.
- **Last audited:** 2026-05-22
- **Primary goals:** stop blocking valid search flags, and keep `bin/pairofcleats.js` aligned with the shared command registry used by TUI/supervisor surfaces.

Current implementation note: the `search` dispatcher now passes arguments through
to `tools/search/cli-entry.js` by default. Opt-in strict dispatch validation is
available via `PAIROFCLEATS_DISPATCH_STRICT=1` or `--strict-dispatch`, and command
metadata lives in `src/shared/command-registry-data.js` plus
`src/shared/command-registry-query.js`.
The historical problem statement below describes the pre-fix state and remains
useful as regression context.

---

## 1. Historical problem statement (pre-fix repo state)

### 1.1 `bin/pairofcleats.js` is a dispatcher with brittle validation
Before the 2026-05-21 reconciliation, `bin/pairofcleats.js`:
- resolves a command/subcommand → script path
- spawns Node to run that script (sync)
- **manually validates flags** via `validateArgs(...)` for several commands

The `search` command was the worst offender:

- It only allowed flags: `repo, mode, top, json, explain, filter, backend`
- It rejected all short flags (e.g. `-n`), even though search supports `-n` via yargs alias.
- It rejected backends beyond `auto|sqlite|lmdb` even though the real search backend policy supports:
  - `sqlite-fts` / `fts`
  - `memory`
  - `tantivy`

Historical code location:
- `bin/pairofcleats.js`:
  - `validateArgs(rest, [...])` inside `if (primary === 'search')`
  - manual backend allowlist: `['auto','sqlite','lmdb']`

### 1.2 “Real” search surface is larger (and already implemented)
The search pipeline consumes many flags across:
- `src/retrieval/cli-args.js` (`parseSearchArgs()`)
- `src/retrieval/cli/normalize-options.js` (bm25/fts/ann knobs)
- `src/retrieval/cli/query-plan.js` (filters: risk/struct/complexity/etc)
- `src/storage/backend-policy.js` (backend selection)

If `bin/pairofcleats.js` blocks flags, **features exist but are unreachable via the main CLI entrypoint** — and the TUI/supervisor dispatch surfaces inherit those limitations. The current search dispatcher no longer applies this allowlist.

---

## 2. Ground truth: search flags and backend values (from repo code)

### 2.1 Backend values
From `src/storage/backend-policy.js::resolveBackendPolicy()` the normalized backend arg supports:
- `auto` (default)
- `sqlite`
- `sqlite-fts` (alias: `fts`)
- `lmdb`
- `tantivy`
- `memory`

(Unknown backend → `backendDisabled=true`, falls back to memory with a warning in `src/retrieval/cli/policy.js`.)

### 2.2 Search flags used by the pipeline
The following flags are referenced by `argv.*` usage across `src/retrieval/**`:

**Core**
- `--repo`
- `--mode`
- `--top` / `-n`
- `--json`, `--compact`, `--stats`, `--explain`, `--why`, `--matched`
- `--context`
- `--comments`
- `--case`, `--case-file`, `--case-tokens`
- `--model`
- `--stub-embeddings`

**Backend/ANN**
- `--backend` (values above)
- `--ann` / `--no-ann`
- `--ann-backend` (normalized in `src/retrieval/cli/normalize-options.js`): `auto|lancedb|sqlite-vector|hnsw|js`
- `--bm25-k1`, `--bm25-b`
- `--fts-profile`
- `--fts-weights`

**Filters (query-plan)**
- `--type`, `--author`, `--import`, `--chunk-author`
- `--lang`, `--ext`, `--file`, `--path`
- `--branch`
- `--modified-after`, `--modified-since`
- `--lint`
- `--alias`
- `--meta` (repeatable), `--meta-json` (repeatable)

Risk:
- `--risk`, `--risk-tag`, `--risk-source`, `--risk-sink`, `--risk-category`, `--risk-flow`

Structure:
- `--struct-pack`, `--struct-rule`, `--struct-tag`

Callsite/type/intent:
- `--calls`, `--uses`, `--signature`, `--param`, `--decorator`
- `--inferred-type`, `--return-type`
- `--throws`, `--reads`, `--writes`, `--mutates`, `--awaits`

Complexity:
- `--branches`, `--loops`, `--breaks`, `--continues`, `--churn`

Traits:
- `--visibility`, `--extends`, `--async`, `--generator`, `--returns`

Expert:
- `--filter "<expr>"` (parsed by `src/retrieval/filters.js::parseFilterExpression()`)

### 2.3 A note on yargs strictness
Most CLIs use `createCli()` which sets `strict(false)` globally (`src/shared/cli.js`).
Search’s `parseSearchArgs()` also uses `strict(false)`.

Therefore, dispatcher-level allowlists are **not** providing robust unknown-flag detection; they are only preventing access to valid features.

---

## 3. Completed reconciliation

### 3.1 `pairofcleats search` pass-through

Implemented in `bin/pairofcleats.js`:

- `return { script: 'tools/search/cli-entry.js', extraArgs: [], args: rest };`

Rationale:
- Search already handles parsing and emits helpful errors.
- Backend selection is already validated/fallback-handled by `src/retrieval/cli/policy.js`.
- This unblocks implemented functionality including `-n`, `--backend tantivy`, `--backend memory`, and `--backend sqlite-fts`.

### 3.2 Strict dispatch mode

Implemented in `bin/pairofcleats.js`:

- `pairofcleats search ...` stays permissive by default.
- `PAIROFCLEATS_DISPATCH_STRICT=1` enables dispatcher-side unknown-flag detection.
- `--strict-dispatch` enables strict validation for a single search invocation and
  is stripped before launching `tools/search/cli-entry.js`.
- Strict validation uses the live search option declarations exported from
  `src/retrieval/cli-args.js`, including `-n` as the supported short value flag
  and `--no-*` forms for known boolean options.

### 3.3 Regression coverage

Current focused coverage:

- `tests/cli/general/cli.test.js` verifies default permissive search pass-through,
  strict flag/env unknown-flag rejection, strict acceptance of `--backend tantivy`
  and `-n`, and `dispatch describe search --json` metadata.
- `tests/cli/search/non-result-surfaces.test.js` verifies search's own value-flag
  and removed-flag errors.

---

## 4. Dispatcher structural status

### 4.1 Goals
1. Make dispatch logic reusable by:
   - `bin/pairofcleats.js` (CLI entry)
   - the Node supervisor (job launcher)
   - any future API server that wants to dispatch tools
2. Remove hand-written validation allowlists as a default behavior.
3. Provide optional “strict dispatch validation” mode for CI/hardening.
4. Provide a machine-readable command manifest for the Rust TUI.

### 4.2 Implemented module structure

Current command metadata lives in:

- `src/shared/command-registry-data.js`
- `src/shared/command-registry-query.js`
- `tools/dispatch/manifest.js`

`bin/pairofcleats.js` imports that registry and uses the registry-backed search path. Some legacy dispatcher cases still perform command-local validation where the underlying tools do not expose their own full option parser; that is intentional and not part of the search flag pass-through gap.

### 4.3 Manifest requirements (for TUI)
Current manifest surfaces expose:
- `pairofcleats dispatch list --json`
- `pairofcleats dispatch describe <command> --json`

For search:
- include backend enum values from `src/storage/backend-policy.js`
- include the full option surface (see 2.2), grouped for UI sections:
  - Query/Output
  - Backend/ANN/Scoring
  - Filters: meta/file/time
  - Filters: risk/struct/complexity/traits

### 4.4 Optional strict validation mode
Active env/flag:
- `PAIROFCLEATS_DISPATCH_STRICT=1` or `pairofcleats search --strict-dispatch …`

In strict mode:
- use per-command option definitions to detect unknown flags
- for search, strict mode relies on a formal options set:
  - `src/retrieval/cli-args.js` explicitly declares the full option surface (still
    `strict(false)` by default, but strict dispatch checks the exported list).

---

## 5. Follow-up: enrich `parseSearchArgs()` option descriptions
To support better help output and manifest generation, keep expanding descriptions in:
- `src/retrieval/cli-args.js::parseSearchArgs`

Add definitions (types + describes) for the flags enumerated in section 2.2.

This is strongly recommended even if we keep yargs `strict(false)`:
- improves help output
- makes it trivial to generate a complete command schema for the TUI

---

## 6. Regression and future testing

### 6.1 Current tests
- `tests/cli/general/cli.test.js`
- `tests/cli/search/non-result-surfaces.test.js`
- `tests/cli/general/cli-completions-and-audit.test.js`

### 6.2 Future unit tests
- registry resolution:
  - `index build`, `index watch`, `index validate` map correctly
  - unknown command prints help and exits 1
- env resolution:
  - build_index goes through runtime envelope path
  - others go through runtime config path

### 6.3 Future integration tests
- `pairofcleats search` accepts:
  - `--backend tantivy`, `--backend memory`, `--backend sqlite-fts`, `--backend fts`
  - `-n`
  - risk/struct/complexity flags (smoke test with `--help`)
- `pairofcleats setup` accepts:
  - `--non-interactive`, `--json`, `--skip-index` (smoke with `--help`)
- `pairofcleats bootstrap` accepts:
  - `--json` etc (smoke with `--help`)

Pass criteria:
- dispatcher does not reject flags
- exit codes correspond to underlying tool behavior (help=0, invalid args=1)

---

## 7. Migration notes for the Rust TUI supervisor
Once the dispatcher manifest exists, the Rust TUI can:
- ask supervisor for `dispatch list/describe`
- populate Run templates and dynamic forms (Search Builder, Setup, Bench) from the manifest
- avoid Rust-side duplication of Node CLI option knowledge
