# PairOfCleats -- Configuration Surface Directives (Flag vs Env vs Config vs Auto)

This document is the governance layer that prevents "option sprawl" from returning after the hard cut. It defines **when something may be configurable**, which mechanism it uses, and what is prohibited.

---

## 1) Configuration mechanisms (definitions)

### 1.1 Code defaults
Hard-coded defaults in the codebase (preferred). They should be safe, conservative, and deterministic.

### 1.2 AutoPolicy (derived configuration)
Values derived at runtime from:
- machine resources (CPU, RAM)
- repo characteristics (file count, bytes, language mix if available)
- capability detection (native modules/extensions present)

**AutoPolicy is the default choice** for performance and safety tuning.

### 1.3 Repo config file (`.pairofcleats.json`)
Persistent settings that apply to a repository/workspace.

### 1.4 CLI flags
Per-invocation overrides, workflow ergonomics, and diagnostics.

### 1.5 Environment variables
Environment variables are supported for both secrets and selected runtime overrides.
The authoritative list is in `docs/config/env-overrides.md`, sourced from `src/shared/env.js`.

---

## 2) Hard rules (non-negotiable)

### Rule A -- Env overrides must be explicit
Environment variables that affect behavior must be explicitly documented in `docs/config/env-overrides.md`.

### Rule B -- One control plane per concept
A concept may be configurable via **only one** of:
- config file, or
- CLI flag, or
- env var (secrets only)

If a concept needs both persistent and per-run control, the persistent control is config, and the per-run control is CLI; env is not allowed.

### Rule C -- Prefer AutoPolicy for tuning
Tuning knobs should default to AutoPolicy. When exposed, they must be documented in the config contract.

### Rule D -- Unknown config keys
Unknown keys fail fast **except** for schema-defined map/extension areas that
allow additional properties. Current exceptions include:
- `indexing` (including `indexing.embeddings` and map-style caps such as
  `indexing.fileCaps.byExt` / `indexing.fileCaps.byLanguage`)
- `retrieval.graphRanking.weights`
- `search.fieldWeights`, `search.sqliteFtsWeights`
- `mcp.toolTimeouts`
- `tooling.pyright`, `tooling.sourcekit`
- `tooling.lsp.servers[]` (server objects allow vendor-specific keys)

### Rule E -- All configuration IO is centralized
- Only the config loader reads `.pairofcleats.json`.
- Only the env secrets module reads `process.env`.
- Only the CLI entrypoint parses CLI args.

All other modules accept a plain options object and do not touch config/env/argv.

---

## 3) Decision matrix: where a setting belongs

### 3.1 Should it be configurable at all?
A setting is user-configurable only if:
- it represents **user intent**, not tuning
- it is stable across runs and machines (or clearly scoped)
- there is a meaningful, understandable choice for a typical user
- the wrong value cannot easily cause corruption or security issues

If the setting is primarily for performance or safety guardrails, it belongs in **AutoPolicy**.

### 3.2 If configurable, choose the mechanism

#### Use repo config file when
- it is persistent per-repo behavior
- it is not a secret
- it is not machine-specific (or can safely vary)

Examples:
- cache root location (disk placement)
- high-level "quality" knob (`auto|fast|balanced|max`)

#### Use CLI flags when
- it is per-invocation behavior
- it changes output format or diagnostics
- it is an ergonomic shortcut

Examples:
- `--repo`
- `--mode`
- `--top`
- `--json`
- `--explain`

#### Use env vars only when
- it is a secret (tokens, credentials), OR
- it must exist before the process starts and cannot be set via CLI/config safely (rare)

Examples:
- `PAIROFCLEATS_API_TOKEN` (secret)
- (standard, not PairOfCleats-specific) `NODE_OPTIONS`, `UV_THREADPOOL_SIZE` if the runtime requires it

Prohibited env var categories:
- feature toggles (`EMBEDDINGS=...`)
- concurrency settings
- backend selection
- logging configuration
- cache behavior and TTLs
- scoring knobs and retrieval tuning

#### Use AutoPolicy when
- it is a tuning value
- it depends on resources or repo size
- it would otherwise create multiple low-level knobs

Examples:
- concurrency and worker pool sizing
- whether embeddings are enabled
- ANN enablement
- chunking limits and batch sizes
- "best available" engine selection (native xxhash/re2/sqlite extension)

---

## 4) Precedence and determinism

### 4.1 Required precedence order
1. CLI flags (per invocation intent)
2. Repo config file (persistent intent)
3. AutoPolicy defaults (derived)
4. Code defaults (fallback)

Environment variables are not in precedence for normal behavior; they are only secrets inputs.

### 4.2 Determinism requirements
- Artifact identity must not depend on hidden env variables.
- If behavior is policy-derived, it must be explainable via `--explain` output (print policy inputs and derived values).
- Two runs on the same machine/repo with the same config must produce the same behavior unless:
  - repo content changed, or
  - tool version changed, or
  - explicit CLI flags changed.

---

## 5) Naming conventions

### 5.1 Config file keys
- Lowercase, structured (`cache.root`, `quality`)
- Avoid deep nested trees; prefer a flat minimal schema.

### 5.2 CLI flags
- Kebab-case (`--cache-root`, `--explain`)
- Avoid multiple flags that control the same concept.
- Avoid boolean negation flags (`--no-x`) unless absolutely necessary; prefer a single enum flag.

### 5.3 Env vars
- Uppercase `PAIROFCLEATS_*`
- Only secrets and deployment-only values
- Must be documented in a single place (and the list must be short)

---

## 6) Adding a new knob (gating requirements)

Any new user-configurable setting must include:

1. **Justification**
   - What user intent does this represent?
   - Why can't AutoPolicy derive it?

2. **Ownership**
   - Named owner + module owner

3. **Single-plane design**
   - Must specify: config OR CLI OR env (never all)
   - Must define precedence (if CLI overrides config)

4. **Tests**
   - Unit test for parsing/validation
   - Integration test demonstrating end-to-end impact

5. **Budget impact**
   - Updates to inventory/budget checks
   - If over budget, an existing knob must be removed in the same change

---

## 7) Anti-patterns (explicitly prohibited)

- "Just add an env var" to get a quick override in CI.
- Multiple flags that set the same internal variable (`--stub-embeddings`, `--real-embeddings`, plus env and config keys).
- Per-feature concurrency settings.
- Exposing backend selection without a compelling product reason.
- Allowing unknown keys in config "for forward compatibility."

---

## 8) Recommended enforcement mechanisms

- CI: fail if `PAIROFCLEATS_` appears outside the secrets module.
- CI: fail if schema keys exceed budget.
- CI: fail if CLI flag count exceeds budget (public allowlist).
- Lint rule: ban `process.env.PAIROFCLEATS_*` usage outside `src/shared/env.js`.
- Runtime: `--explain` prints policy resolution to reduce "why did it do that?" tickets.

---

## 9) Practical examples (how to apply these directives)

### Example 1 -- "We need to control thread count"
Correct approach:
- Do not add `--threads` or `PAIROFCLEATS_THREADS`.
- Add AutoPolicy derivation.
- If user control is required, add a single high-level `quality` mode and document that `fast` uses fewer threads.

### Example 2 -- "We need to disable embeddings on low memory"
Correct approach:
- AutoPolicy detects RAM and disables embeddings automatically.
- No user knob, no env var.

### Example 3 -- "We need to provide an API token"
Correct approach:
- Env var: `PAIROFCLEATS_API_TOKEN`
- Not in config file.
- Not in CLI (to avoid leaking into shell history).

### Example 4 -- "We want a diagnostic switch"
Correct approach:
- CLI flag: `--explain` (or `--debug`)
- Must not change stored artifacts; it only changes logging/output.
