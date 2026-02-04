# Dispatcher rewrite + Search flags reconciliation spec — v1

## Status
- **Spec version:** 1
- **Audience:** PairOfCleats contributors working on the TUI + Node supervisor boundary
- **Primary goals:** stop blocking valid search flags, and restructure `bin/pairofcleats.js` into an implementation-ready dispatcher module usable by the TUI supervisor.

This spec references existing code paths extensively and proposes concrete changes.

---

## 1. Problem statement (current repo state)

### 1.1 `bin/pairofcleats.js` is a dispatcher with brittle validation
`bin/pairofcleats.js` currently:
- resolves a command/subcommand → script path
- spawns Node to run that script (sync)
- **manually validates flags** via `validateArgs(...)` for several commands

The `search` command is the worst offender:

- It only allows flags: `repo, mode, top, json, explain, filter, backend`
- It rejects all short flags (e.g. `-n`), even though search supports `-n` via yargs alias.
- It rejects backends beyond `auto|sqlite|lmdb` even though the real search backend policy supports:
  - `sqlite-fts` / `fts`
  - `memory`
  - `tantivy`

Code location:
- `bin/pairofcleats.js`:
  - `validateArgs(rest, [...])` inside `if (primary === 'search')`
  - manual backend allowlist: `['auto','sqlite','lmdb']`

### 1.2 “Real” search surface is larger (and already implemented)
The search pipeline consumes many flags across:
- `src/retrieval/cli-args.js` (`parseSearchArgs()`)
- `src/retrieval/cli/normalize-options.js` (bm25/fts/ann knobs)
- `src/retrieval/cli/query-plan.js` (filters: risk/struct/complexity/etc)
- `src/storage/backend-policy.js` (backend selection)

If `bin/pairofcleats.js` blocks flags, **features exist but are unreachable via the main CLI entrypoint** — and the planned TUI (which aligns to dispatch jobs) inherits those limitations.

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

## 3. Required changes (immediate reconciliation)

### 3.1 Minimal safe fix for `pairofcleats search`
In `bin/pairofcleats.js`:
- remove the call to `validateArgs(...)` inside the `search` command handler
- remove the manual backend allowlist check

Replace with pass-through:

- `return { script: 'search.js', extraArgs: [], args: rest };`

Rationale:
- Search already handles parsing and emits helpful errors.
- Backend selection is already validated/fallback-handled by `src/retrieval/cli/policy.js`.
- This instantly unblocks all implemented functionality (including `-n`, `--backend tantivy`, etc).

### 3.2 Correctness tests to add immediately
Add a new integration test script (fits current test harness pattern) that executes:

1) `node bin/pairofcleats.js search --help --backend tantivy`
- **Pass:** exit code is 0 (help printed), and dispatcher did not reject backend.
- **Fail:** exit code 1 with “Unsupported --backend …”

2) `node bin/pairofcleats.js search --help -n 10`
- **Pass:** exit code is 0
- **Fail:** exit code 1 with “Unknown short flag: -n”

(Using `--help` avoids needing indexes; we are testing dispatch acceptance.)

---

## 4. Dispatcher rewrite plan (structural improvement)

### 4.1 Goals
1. Make dispatch logic reusable by:
   - `bin/pairofcleats.js` (CLI entry)
   - the Node supervisor (job launcher)
   - any future API server that wants to dispatch tools
2. Remove hand-written validation allowlists as a default behavior.
3. Provide optional “strict dispatch validation” mode for CI/hardening.
4. Provide a machine-readable command manifest for the Rust TUI.

### 4.2 Proposed module structure

Create `src/shared/dispatch/`:

- `registry.js`
  - data-only registry of commands:
    - name/subcommands
    - script path
    - description
    - recommended progress mode (`jsonl`)
    - expected outputs (json vs text)
    - artifact kinds expected (for artifact indexing pass)
- `resolve.js`
  - parses argv to resolve command/subcommand
- `env.js`
  - computes runtime env for the resolved command:
    - for `build_index.js`: retain current runtime-envelope path used in `bin/pairofcleats.js`
    - otherwise: `getRuntimeConfig(...)` + `resolveRuntimeEnv(...)`
- `spawn.js`
  - shared spawn helper (async + streaming friendly; supervisor will need async)
- `manifest.js`
  - exports manifest JSON schema + `describeCommand(name)` outputs options schema and expected artifacts

Then:
- rewrite `bin/pairofcleats.js` as a thin wrapper that calls into `src/shared/dispatch/*`.

### 4.3 Manifest requirements (for TUI)
Expose:
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
Add env/flag:
- `PAIROFCLEATS_DISPATCH_STRICT=1` or `pairofcleats --strict …`

In strict mode:
- use per-command option definitions to detect unknown flags
- for search, strict mode relies on a formal options set:
  - update `src/retrieval/cli-args.js` to explicitly declare the full option surface (still `strict(false)` by default, but strict dispatch can check the registry’s list).

---

## 5. Follow-up: formalize `parseSearchArgs()` option list
To support better help output and manifest generation, expand the `options` object in:
- `src/retrieval/cli-args.js::parseSearchArgs`

Add definitions (types + describes) for the flags enumerated in section 2.2.

This is strongly recommended even if we keep yargs `strict(false)`:
- improves help output
- makes it trivial to generate a complete command schema for the TUI

---

## 6. Testing plan (dispatcher rewrite)

### 6.1 Unit tests
- registry resolution:
  - `index build`, `index watch`, `index validate` map correctly
  - unknown command prints help and exits 1
- env resolution:
  - build_index goes through runtime envelope path
  - others go through runtime config path

### 6.2 Integration tests
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
