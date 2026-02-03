# PairOfCleats -- Config/Flags/Env Simplification Execution Plan (Phased, Big-Bang Outcome)

This document is a **planned future** execution outline. It does **not** describe current behavior.
For the current contract, see `docs/config/contract.md` and `docs/config/schema.json`.
It assumes the end-state described in `docs/config/hard-cut.md` (minimal config, minimal flags, secrets-only env, AutoPolicy-driven behavior).

## Status legend (matches NEW_ROADMAP style)

- [x] Implemented and verified end-to-end
- [ ] Not complete / needs tests / has correctness gaps

## Guiding constraints

- No deprecation period. When a knob is cut, it is removed.
- Default to deleting code paths rather than "keeping it but undocumented."
- Each phase should land in a runnable state (tests may evolve, but core CLI must function).
- Use current mode names (`code`, `prose`, `extracted-prose`, `records`, `all`);
  avoid legacy `metadata-only`.
- Provider policy references should target tooling providers (clangd/pyright/ts)
  rather than editor-specific labels.

---

## Phase 0 -- Freeze the contract and add enforcement (stop the bleeding)

**Objective:** Ensure the simplification effort cannot regress during implementation.

### 0.1 Define "public surface" allowlists
- [ ] Create a **public allowlist** for:
  - config keys (target: 2)
  - env vars (target: 1)
  - CLI flags (target: ~20 across core commands)

**Where**
- New file: `docs/config/contract.md` (short, explicit whitelist)
- New file: `docs/config/budgets.md` (numeric budgets + rationale)

### 0.2 Make the inventory actionable in CI
- [ ] Extend `tools/config/inventory.js` to output:
  - totals (already)
  - "public" vs "internal/dev-only" flags (new)
- [ ] Add a CI check script (or npm script) that fails when budgets are exceeded.

**Where**
- `tools/config/inventory.js` (classification hooks)
- `package.json` (add `npm run config:budget`)

**Exit criteria**
- [ ] CI fails if public budgets are exceeded.
- [ ] `docs/config/contract.md` exists and matches intended end-state.

**PR slice**
- PR0: enforcement only (no behavior changes)

---

## Phase 1 -- Introduce MinimalConfig + AutoPolicy (without deleting everything yet)

**Objective:** Land the new primitives first: a minimal config loader/validator and an AutoPolicy resolver. This reduces risk because subsequent deletions become "wire to policy" vs "invent behavior."

### 1.1 Minimal config schema
- [ ] Replace `docs/config/schema.json` with a minimal schema:
  - `cache.root`
  - `quality`
- [ ] Make unknown keys an error (fail fast).

**Where**
- `docs/config/schema.json`
- `tools/config/validate.js` (validate only minimal shape)
- `tools/config-reset.js` (emit minimal config only; remove anything else)
- `tools/config/dump.js` (dump minimal config + derived policy; optional but recommended)

### 1.2 Minimal config load path
- [ ] Update `tools/shared/dict-utils.js:loadUserConfig()`:
  - load `.pairofcleats.json`
  - validate against minimal schema
  - return minimal config only
  - remove fallback-to-tool-root config unless you explicitly want it

**Where**
- `tools/shared/dict-utils.js`
- `src/shared/jsonc.js` (no change expected)

### 1.3 AutoPolicy (resource-derived decisions)
- [ ] Add `src/shared/auto-policy.js`:
  - resource detection: CPU, RAM
  - repo scan: file count + size estimate (fast; early-stop allowed)
  - outputs: `quality`, concurrency, feature toggles, backend decisions
- [ ] Wire AutoPolicy creation into central entrypoints, but do not yet remove old config reads (Phase 4/5 will delete them).

**Where**
- `src/shared/auto-policy.js` (new)
- `tools/shared/dict-utils.js` (export `getAutoPolicy(repoRoot, config)` or similar)
- `bin/pairofcleats.js` (optional: pass policy into child scripts via args rather than env)

### 1.4 Contract tests
- [ ] Add tests that enforce the new contract:
  - unknown config key ⇒ error
  - `quality=auto` resolves deterministically given mocked resources/repo metrics

**Where**
- New tests (suggested):
  - `tests/config/minimal-schema.test.js`
  - `tests/shared/config/auto-policy.test.js`

**Exit criteria**
- [ ] `pairofcleats config validate` only accepts minimal config.
- [ ] AutoPolicy unit tests exist and pass.
- [ ] No new knobs introduced during Phase 1.

**PR slices**
- PR1A: minimal schema + config tools
- PR1B: AutoPolicy module + tests
- PR1C: minimal config loader wiring

---

## Phase 2 -- Remove profiles completely (delete the system)

**Objective:** Delete the profile control plane (files + env + flag + merge logic) to remove a major source of precedence confusion.

### 2.1 Delete profile artifacts
- [ ] Delete `profiles/` directory.
- [ ] Remove `profile` key from config schema (already removed in Phase 1).
- [ ] Remove profile references in docs (`docs/guides/commands.md` currently states "Experimental commands require profile=full").

### 2.2 Remove profile logic from code
- [ ] In `tools/shared/dict-utils.js`:
  - delete `PROFILES_DIR`, `loadProfileConfig`, `applyProfileConfig`
  - remove env/config/cli profile selection logic
- [ ] In `src/shared/cli.js`:
  - remove `profile` as a shared option
  - remove any automatic injection of profile defaults
- [ ] In `src/retrieval/cli-args.js`:
  - remove `--profile`

### 2.3 Remove env var `PAIROFCLEATS_PROFILE`
- [ ] Remove from `src/shared/env.js` (Phase 3 will rewrite env.js fully, but delete here if you want faster reduction).
- [ ] Remove any tests that rely on profiles.

**Exit criteria**
- [ ] No `profiles/` directory.
- [ ] No references to `PAIROFCLEATS_PROFILE` or `--profile`.
- [ ] Help text and docs no longer mention profiles.

**PR slices**
- PR2A: delete profiles dir + docs updates
- PR2B: delete profile merge logic + remove CLI option

---

## Phase 3 -- Remove env override plumbing (secrets-only env)

**Objective:** Eliminate the "second configuration system" implemented via environment variables.

### 3.1 Rewrite env module
- [ ] Replace `src/shared/env.js` with secrets-only access:
  - `getSecretsEnv()` returns `{ apiToken }`
  - remove parsing helpers for booleans/enums/numbers unless needed elsewhere
- [ ] Ensure no code path uses env vars for normal behavior.

**Where**
- `src/shared/env.js` (rewrite)
- Search for call-sites of `getEnvConfig()` and replace them.

### 3.2 Replace `getEnvConfig()` call-sites
These are present across index build, retrieval, tools, and tests (see grep results in the repo). Treat as a hard requirement: **no runtime behavior should depend on env vars except secrets**.

Primary call-sites to touch (non-exhaustive, but strongly suggested as a checklist):
- `src/index/build/file-processor.js` (progress flags)
- `src/index/build/indexer/pipeline.js`
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/runtime/runtime.js`
- `src/index/build/watch.js`
- `src/integrations/core/index.js`
- `src/integrations/core/status.js`
- `src/retrieval/cli.js`
- `src/retrieval/output/cache.js`
- `src/shared/hash.js`
- `tools/*` (cache-gc, clean-artifacts, config-dump, vector-extension, services, benches, etc.)
- `tests/perf/bench/run.test.js`

Replacement strategy:
- If it was a **debug/diagnostic** toggle (progress lines, verbose): delete or move to `--explain` only.
- If it was a **resource/perf** knob (threads, worker pool, old space): derive in AutoPolicy.
- If it was a **behavior toggle** (embeddings, backend, fts profile): derive in AutoPolicy and delete user override.

### 3.3 Delete env documentation
- [ ] Rewrite `docs/config/env-overrides.md` to "Secrets only: `PAIROFCLEATS_API_TOKEN`."
- [ ] Remove mentions of env-driven profiles, embeddings toggles, thread knobs, etc.

### 3.4 Update config hash behavior
`tools/shared/dict-utils.js:getEffectiveConfigHash()` currently includes env in the hash.
- [ ] Remove env from the effective config hash (or include only secrets-free stable env inputs if you truly need them).
- [ ] Goal: artifact identity is driven by config + repo content + tool version, not hidden envs.

**Exit criteria**
- [ ] No `PAIROFCLEATS_*` env vars used for behavior except `PAIROFCLEATS_API_TOKEN`.
- [ ] `getEffectiveConfigHash()` is not sensitive to random env settings.
- [ ] Docs reflect secrets-only env.

**PR slices**
- PR3A: rewrite env.js + secrets-only doc update
- PR3B: replace call-sites + delete env-based behavior
- PR3C: remove env from effective-config hashing

---

## Phase 4 -- Collapse the public CLI (flags) to a strict whitelist

**Objective:** Remove flag sprawl and duplicated flags across scripts by making the CLI surface strict and small.

### 4.1 Decide which commands remain public
Recommended: keep only these as "public" commands (others can remain as internal node scripts, but not advertised or supported):
- `setup`
- `bootstrap`
- `index build` / `index watch` / `index validate`
- `search`
- `service api`

Everything else becomes:
- deleted, or
- moved under `pairofcleats internal ...` (optional), or
- invoked directly via `node tools/...` (dev-only)

### 4.2 Rewrite CLI parsing to be strict
Right now the project has many scripts each defining their own options. The fastest simplification is to centralize user-facing options in one place and make it strict:

- [ ] Update `bin/pairofcleats.js` to:
  - dispatch only the public commands above
  - reject unknown commands
  - not pass through arbitrary args to internal scripts
- [ ] Update per-command option parsing to only accept the whitelist.
  - For search, this means rewriting `src/retrieval/cli-args.js`.

**Where**
- `bin/pairofcleats.js`
- `src/retrieval/cli-args.js`
- `build_index.js` or `src/index/build/args.js` (where build flags are defined)

### 4.3 Collapse search filters
The current search CLI defines dozens of flags (`author`, `lang`, `risk-*`, `struct-*`, etc.). Replace them with either:
- query language filters (`lang:ts path:src type:function`), or
- a single `--filter "<expr>"` flag

Implementation tasks:
- [ ] Add a query filter parser (minimal):
  - only a small set of filters at first: `lang`, `path`, `type`
- [ ] Remove per-filter CLI flags.
- [ ] Update `docs/guides/search.md` / `docs/contracts/search-contract.md` to reflect the new mechanism.

### 4.4 Delete duplicate options across scripts
Inventory indicates flags like `--repo`, `--out`, `--json` appear in many files.
- [ ] Remove those flags from the internal scripts once the CLI wrapper is strict.
- [ ] Internal scripts should accept explicit parameters from the wrapper, not implement their own CLI.

**Exit criteria**
- [ ] `pairofcleats --help` shows only the public commands.
- [ ] Unknown flags error out.
- [ ] Search uses query filters or `--filter`, not dozens of flags.

**PR slices**
- PR4A: strict public command routing in `bin/pairofcleats.js`
- PR4B: rewrite search CLI args to whitelist
- PR4C: refactor build/index args to whitelist

---

## Phase 5 -- Remove user-configurable indexing knobs (wire indexing to AutoPolicy)

**Objective:** Delete `indexing.*` configurability by deriving values via AutoPolicy and making pipeline decisions internal.

### 5.1 Identify indexing config consumption points
Focus modules (from `docs/config/inventory-notes.md` and structure):
- `src/index/build/runtime.js`
- `src/index/build/runtime/runtime.js`
- `src/index/build/runtime/workers.js`
- `src/index/build/indexer.js`
- `src/index/build/file-processor.js`
- `src/index/build/worker-pool.js`
- `src/index/build/chunking/*` and `src/index/chunking/limits.js`

### 5.2 Replace config reads with policy values
- [ ] Create a single `IndexBuildContext` (or similar) that includes:
  - `config` (minimal)
  - `policy` (AutoPolicy)
- [ ] Thread the policy through the build orchestration so downstream modules do not read config/env directly.
- [ ] Delete or ignore the now-unused config keys.

Concrete replacements:
- concurrency: use `policy.indexing.concurrency`
- embeddings enablement: `policy.indexing.embeddings.enabled`
- chunking limits: `policy.indexing.chunking.*`
- worker pool sizing: `policy.runtime.workerPool.*`

### 5.3 Remove stage toggles
Remove:
- env `PAIROFCLEATS_STAGE`
- config `indexing.stage` (and similar)
Make the pipeline deterministic and fixed.

### 5.4 Update tests
- [ ] Remove tests that assert behavior of deleted knobs.
- [ ] Add tests that assert:
  - policy-derived concurrency is used
  - embeddings are enabled/disabled solely based on policy inputs

**Exit criteria**
- [ ] No code reads `indexing.*` from user config.
- [ ] Index build outcome is driven by AutoPolicy + repo inputs.
- [ ] Test coverage exists for policy-driven decisions.

**PR slices**
- PR5A: thread policy through index build
- PR5B: delete indexing config plumbing and dead code

---

## Phase 6 -- Remove user-configurable search knobs (wire retrieval to AutoPolicy)

**Objective:** Delete `search.*` configurability and backend/scoring knobs. Retrieval becomes "one good default pipeline," with only `--top`, `--json`, `--explain` remaining.

### 6.1 Remove backend selection knobs
- [ ] Make retrieval always use SQLite indexes.
- [ ] Delete `--backend`, `--ann-backend`, `--ann/--no-ann` from the public CLI.
- [ ] Any ANN usage is auto-detected by capabilities and policy.

**Where**
- `src/retrieval/cli.js`
- `src/retrieval/pipeline.js`
- `src/retrieval/sqlite-helpers.js`
- `tools/build/sqlite/*`

### 6.2 Remove scoring knobs
Delete:
- `search.bm25.*` and `--bm25-*`
- `--fts-profile`, `--fts-weights`, env `PAIROFCLEATS_FTS_PROFILE`

Replace with:
- fixed scoring defaults
- (optional) policy switches by quality (fast/balanced/max), but not user-tunable parameters

### 6.3 Cache knobs removal
If `docs/guides/query-cache.md` exists as user-configurable, collapse to:
- internal cache with fixed limits, or
- off by default if not essential
No user knobs.

**Exit criteria**
- [ ] No code reads `search.*` from config.
- [ ] No user-facing backend or scoring knobs remain.
- [ ] Search always works with default pipeline + optional explain output.

**PR slices**
- PR6A: make SQLite the only retrieval backend
- PR6B: delete scoring knobs and policy complexity

---

## Phase 7 -- Backend and extension simplification (delete LMDB and vector-extension config)

**Objective:** Remove entire feature sets that create configuration branching.

### 7.1 Remove LMDB support
- [ ] Delete:
  - `tools/build/lmdb-index.js`
  - LMDB-related runtime modules (if any)
  - `lmdb.*` config namespace (already removed by schema)
  - `pairofcleats lmdb build` dispatch from `bin/pairofcleats.js`
  - docs: `docs/guides/external-backends.md` references

### 7.2 Vector extension: auto only
- [ ] Remove:
  - env `PAIROFCLEATS_VECTOR_EXTENSION`
  - config `sqlite.vectorExtension.*`
- [ ] Make extension lookup fixed to tool-managed directory:
  - `tools/download/extensions.js` installs into a known location
  - runtime checks presence and enables if available
  - never require user path overrides

**Where**
- `tools/sqlite/vector-extension.js`
- `tools/download/extensions.js`
- `docs/sqlite/ann-extension.md` (rewrite to "auto")

**Exit criteria**
- [ ] No LMDB code paths.
- [ ] Vector extension has no user-configurable paths; it is fully auto.

**PR slices**
- PR7A: remove LMDB
- PR7B: remove vector extension config/env overrides

---

## Phase 8 -- Delete dead code/docs/tests and lock in the new minimal surface

**Objective:** Remove everything that exists only to support deleted knobs and ensure the repo stays simplified.

### 8.1 Dead docs cleanup
Delete or rewrite:
- `docs/config/deprecations.md` (delete)
- `docs/config/env-overrides.md` (rewrite to secrets-only)
- `docs/guides/external-backends.md` (rewrite or delete)
- any "profile=full required" sections in `docs/guides/commands.md`

### 8.2 Remove unused helper APIs from `tools/shared/dict-utils.js`
After the hard cut, `tools/shared/dict-utils.js` likely still contains:
- paths and resolvers for removed backends
- config accessors for deleted namespaces (`getRuntimeConfig`, `getModelConfig`, etc.)

Action:
- [ ] Trim exports to only what the remaining public CLI and build/search paths require.
- [ ] Anything else is deleted or moved to internal modules.

### 8.3 Re-run and commit inventory
- [ ] Run `node tools/config/inventory.js` and commit the new `docs/config/inventory.*`
- [ ] Confirm budgets and enforce.

### 8.4 Add a "no new knobs" guard
Options:
- lint rule: "no direct `process.env.PAIROFCLEATS_*` usage outside env module"
- CI scan: grep for `PAIROFCLEATS_` usage and fail if not allowlisted
- tests: assert schema keys <= budget

**Exit criteria**
- [ ] Inventory shows minimal counts.
- [ ] CI budget enforcement passes.
- [ ] No documentation references removed knobs.

**PR slices**
- PR8A: dead code/docs removal
- PR8B: enforcement hardening

---

## Appendix A -- Expected breaking changes (explicit)

- `.pairofcleats.json` only accepts `cache.root` and `quality`. All other keys hard-fail.
- All `PAIROFCLEATS_*` env overrides are removed except `PAIROFCLEATS_API_TOKEN`.
- Profiles are removed. Any workflow that relied on `profile=full` must be rewritten or deleted.
- Search filtering via dozens of CLI flags is removed. Filtering must move into the query language or a single `--filter` expression.
- Backend selection is removed; SQLite is the only backend.

---

## Appendix B -- Validation checklist (repeatable)

After Phase 8, the following should be true:

1. `pairofcleats index build` works on a representative repo with zero config.
2. `pairofcleats search "foo"` works and returns results.
3. `pairofcleats search --explain "foo"` prints derived policy decisions (quality, backend mode, etc.).
4. `node tools/config/inventory.js` outputs:
   - config keys <= 5
   - env vars == 1
   - CLI flags <= 25 for public commands
5. Grep check:
   - no usage of `PAIROFCLEATS_` outside secrets allowlist
6. CI green.

---

## Appendix C -- Concrete PR ordering recommendation (fastest path)

If you want the shortest calendar time with manageable PR sizes:

1. PR0: budgets + CI enforcement (no behavior changes)
2. PR1A/1B/1C: minimal schema + AutoPolicy + config loader
3. PR2A/2B: delete profiles
4. PR3A/3B/3C: delete env override system
5. PR4A/4B/4C: strict CLI and flag collapse
6. PR5A/5B: indexing -> policy
7. PR6A/6B: retrieval -> policy
8. PR7A/7B: remove LMDB and vector config
9. PR8A/8B: cleanup and lock in

