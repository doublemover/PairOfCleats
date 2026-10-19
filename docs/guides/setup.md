# Unified Setup

Bootstrap evidence separates package loadability, per-language parser activation,
provider initialization, and project qualification. Required registered native
grammars activate in isolated bounded processes using the production binding
resolver and a tiny language-specific sample. The readiness receipt records
language, package/version, Node version and ABI for activated routes. Parsing a
sample does not certify a compiler/LSP project or full language semantics. A
loadable grammar that fails `setLanguage` is not parser-activated.

Locked checkout bootstrap requires Node 26.10.0 or newer within 26.x and includes
development dependencies. Its required native
verification now also creates a real node-pty session, checks child output and
waits for natural process exit so a leaked ConPTY connection worker cannot hide
behind a forced probe exit. The required node-pty 1.1.0 patch closes that worker
and its input socket after natural-exit output flush. This bounded disposal
check does not replace native TUI supervisor/process-family qualification. The
worker-teardown access violation is attributed to Node 26.8.1 itself; see the
[runtime policy](node-runtime.md).

The required `docx` 9.5.3 patch keeps its bundled deprecation helper on Node's
process flags instead of reading browser localStorage. Both official Node
exports generate real DOCX documents without the experimental-storage warning;
the browser distribution retains its existing behavior. Locked bootstrap applies
and verifies this patch alongside the native dependency patches.

The same node-pty patch corrects the macOS prebuilt `spawn-helper` execute bits
during its rebuild script. The locked 1.1.0 tarball ships both Darwin helpers at
0644, so an import alone succeeds while a real PTY spawn fails. Setup requires
a regular helper file before changing its executable bits; verify-only probes
do not repair it. This changes the installed dependency artifact, not host
security policy. A successful bounded spawn/disposal probe remains required.

The unified setup script (`pairofcleats setup`) guides you through installing optional dependencies and building indexes in one flow. It is interactive by default.

First prepare the source checkout with Node >=26.10.0 <27 and `npm run bootstrap:ci`.
The normal CLI requires verified bootstrap before it can start guided setup.
Use `--skip-install` below to retain that locked dependency graph while selecting
optional assets and index steps. The setup script's explicit install step uses
`npm install` and can change dependency resolution; it is not a replacement for
checkout bootstrap. See the [runtime policy](node-runtime.md).

## Contributor workspace files

Disposable development outputs use `temp/dev/`, resolved by
`tools/shared/dev-artifacts.js`. Test fixtures use `tests/helpers/test-cache.js`
instead of constructing their own cache directory. Do not place generated
inputs inside the checked-in `tests/fixtures` trees.
Import-resolution replay discovery scans the current test/benchmark roots
first and retains the legacy roots for historical inputs, under its existing
report-count bound.

| Location | Owner and lifetime |
| --- | --- |
| `temp/dev/tests/cache/` | Disposable fixture inputs and indexes; each test owns its named or isolated child. |
| `temp/dev/tests/coverage/` | Runner V8 coverage data and merged reports. |
| `temp/dev/benchmarks/` | Disposable benchmark workspaces. Measured result artifacts use the benchmark's explicit output. |
| `temp/dev/ci/cache/`, `temp/dev/ci/home/` | Isolated CI-suite cache and home defaults. |
| `.testLogs/` | Runner receipts, latest pointer and CI artifacts; retain original failure evidence until its audit closes. |
| `.diagnostics/` | Existing CI diagnostic artifact interface; workflows upload these receipts. |
| `temp/tasks/<task>/` | Task-scoped dumps, dependency evidence and working receipts; retain provenance. |
| OS application cache | Product models, tools and indexes, resolved by `src/shared/cache-roots.js`; contributor cleanup does not purge it. |

All these workspace outputs are ignored by Git. `.git/` and `.github/` are
repository metadata/source, not disposable caches. The legacy `.testCache/`,
`tests/.cache/`, `.benchCache/`, `.c8/` and `.tmp/` ignore rules remain so old
tools cannot accidentally stage generated files. Hosted workflows can still
explicitly select ignored `.ci-cache/` roots for their cache actions. Old author caches are not
clean-checkout test inputs. Stop their owning processes before cleanup and
resolve every target within the intended workspace; retain logs and task
receipts separately from disposable cache data. A task-local archival move
should record each original and new path rather than silently rewriting old
receipts.

## Usage

- Interactive (recommended):
  - `node bin/pairofcleats.js setup --skip-install`
- Non-interactive:
  - `node tools/setup/setup.js --non-interactive --skip-install`
- Non-interactive with JSON summary:
  - `node tools/setup/setup.js --non-interactive --skip-install --json`

## What it can do

- Install Node dependencies (`npm install`).
- Download dictionaries (English wordlist by default).
- Download embedding models.
- Download the SQLite ANN extension when available.
- Detect and optionally install tooling.
- Restore CI artifacts when present.
- Build file-backed indexes (optionally incremental).
- Build SQLite indexes (default unless `--skip-sqlite`).

## Flags

- Flags below apply to the direct script (`node tools/setup/setup.js`):
  - `--non-interactive` / `--ci`: Skip prompts and use defaults.
  - `--json`: Emit a summary report to stdout (logs go to stderr).
  - `--with-sqlite`: Force SQLite build on (default behavior).
  - `--incremental`: Use incremental indexing if available.
  - `--validate-config`: Validate `.pairofcleats.json` before running setup.
  - `--skip-validate`: Skip config validation prompts.
  - `--tooling-scope cache|global`: Override tooling install scope.
  - `--require-steps <csv>`: Treat the named checks as prerequisites, for example `dictionaries,tooling`. Missing, skipped, declined or failed prerequisites produce a nonzero exit; this does not enable a skipped operation.
  - `--skip-install`: Skip `npm install`.
  - `--skip-dicts`: Skip dictionary download.
  - `--skip-models`: Skip model download.
  - `--skip-extensions`: Skip SQLite extension download.
  - `--skip-tooling`: Skip tooling detection/install.
  - `--skip-artifacts`: Skip CI artifact restore.
  - `--skip-index`: Skip file-backed index build.
  - `--skip-sqlite`: Skip SQLite index build.

## Notes

- The JSON summary includes a readiness receipt for the selected checks: `ready`, `degraded` for optional omissions, or `blocked` for required failures. Failed requested dependency/config/index/SQLite steps block completion. Optional download/tooling failures remain visible and no longer print an unconditional success message.
- Tool installation rechecks executable resolution, the command probe and package layout after the installer exits. A successful installer process without a working executable is a failure; manual-only tools remain explicit prerequisites requiring action. The receipt identifies this verification level. It does not claim an LSP initialize/workspace check, complete model validation or native-extension loading from a presence/probe check alone; those capabilities require their own admission checks.

- Defaults follow `.pairofcleats.json` where applicable.
- Tree-sitter grammars load via native `tree-sitter` language modules.
- SQLite builds use file-backed indexes by default, and will stream from piece artifacts or incremental bundles when available.
- `build_index.js` can be run from any working directory; it resolves SQLite build tooling from the install root.
- Index builds write `preprocess.json` under the repo cache root with scan and skip statistics.
- Default ignore patterns can be overridden by adding negated entries (e.g. `!dist/allow.js`) in `extraIgnore`.
- Ignore files configured via `ignoreFiles` must resolve inside the repo root; outside paths are skipped with a warning.
- Index builds write `pieces/manifest.json` in each index directory to list artifact pieces and checksums.
- Use `node tools/index/assemble-pieces.js --input <indexDir> --out <dest>` to merge piece outputs into a single index directory.
- Use `node tools/index/compact-pieces.js --repo <repo>` to compact chunk_meta parts and token_postings shards.
- After setup, run `pairofcleats index validate` to confirm index artifacts are healthy.
- If you prefer a fast, no-prompts path, use `pairofcleats bootstrap`.
