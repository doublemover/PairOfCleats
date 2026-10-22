# Editor Integration

## CLI contract for editor tooling

Editor integrations use structured JSON contracts for editor-facing workflows.

- VS Code shells out to the CLI with `--json`.
- Sublime Text shells out to the CLI for index, map, analysis, workspace, and operator workflows.
- Sublime Text can use the service API for search/symbol lookup when `api_execution_mode` allows it, and uses explicit API-only commands for server health/status surfaces.

The JSON payload includes top-level search buckets (`code`, `prose`, `extractedProse`, `records`) plus backend and optional stats/explain fields.

## Deterministic packaging flow

Canonical packaging commands:

```bash
node tools/package-sublime.js
node tools/package-vscode.js
```

Smoke checks (used by release-check):

```bash
node tools/package-sublime.js --smoke
node tools/package-vscode.js --smoke
```

Packaging behavior is deterministic:

- stable file ordering
- normalized archive roots (`PairOfCleats/`, `extension/`)
- fixed archive metadata (`mtime`, mode bits)
- per-archive SHA-256 output and JSON manifest

See `docs/specs/editor-packaging-determinism.md` for contract details.

## VS Code extension

The bundled VS Code extension lives in `extensions/vscode` and defines:

- `PairOfCleats: Search`
- `PairOfCleats: Search Selection`
- `PairOfCleats: Search Symbol Under Cursor`
- `PairOfCleats: Repeat Last Search`
- `PairOfCleats: Explain Search`
- `PairOfCleats: Open Index Directory`
- `PairOfCleats: Index Build`
- `PairOfCleats: Start Index Watch`
- `PairOfCleats: Stop Index Watch`
- `PairOfCleats: Index Validate`
- `PairOfCleats: Start Service API`
- `PairOfCleats: Stop Service API`
- `PairOfCleats: Start Service Indexer`
- `PairOfCleats: Stop Service Indexer`
- `PairOfCleats: Setup`
- `PairOfCleats: Bootstrap`
- `PairOfCleats: Tooling Doctor`
- `PairOfCleats: Config Dump`
- `PairOfCleats: Index Health`
- `PairOfCleats: Code Map`
- `PairOfCleats: Architecture Check`
- `PairOfCleats: Impact Analysis`
- `PairOfCleats: Suggest Tests`
- `PairOfCleats: Workspace Manifest`
- `PairOfCleats: Workspace Status`
- `PairOfCleats: Workspace Build`
- `PairOfCleats: Workspace Catalog`
- `PairOfCleats: Workflow Status`
- `PairOfCleats: Rerun Last Workflow`
- `PairOfCleats: Recent Workflows`
- `PairOfCleats: Reopen Last Results`
- `PairOfCleats: Search History`
- `PairOfCleats: Group Results by Section`
- `PairOfCleats: Group Results by File`
- `PairOfCleats: Group Results by Query`

Settings:

- `pairofcleats.cliPath`
- `pairofcleats.nodePath` (User Settings only; empty uses the editor process PATH)
- `pairofcleats.cliArgs`
- `pairofcleats.apiServerUrl`
- `pairofcleats.apiTimeoutMs`
- `pairofcleats.apiExecutionMode`
- `pairofcleats.searchMode`
- `pairofcleats.searchBackend`
- `pairofcleats.searchAnn`
- `pairofcleats.maxResults`
- `pairofcleats.searchContextLines`
- `pairofcleats.searchFile`
- `pairofcleats.searchPath`
- `pairofcleats.searchLang`
- `pairofcleats.searchExt`
- `pairofcleats.searchType`
- `pairofcleats.searchAsOf`
- `pairofcleats.searchSnapshot`
- `pairofcleats.searchFilter`
- `pairofcleats.searchAuthor`
- `pairofcleats.searchModifiedAfter`
- `pairofcleats.searchModifiedSince`
- `pairofcleats.searchChurn`
- `pairofcleats.searchCaseSensitive`
- `pairofcleats.env`
- `pairofcleats.extraSearchArgs`
- `pairofcleats.inlineHoverEnabled`
- `pairofcleats.inlineDiagnosticsEnabled`
- `pairofcleats.inlineDecorationsEnabled`
- `pairofcleats.inlineMaxItems`

The VS Code search command forwards these common search flags directly instead of forcing normal workflows through `extraSearchArgs`. `pairofcleats.searchAsOf` and `pairofcleats.searchSnapshot` are mutually exclusive; if both are set, the extension fails closed with an explicit configuration error.

VS Code API-backed workflow behavior:

- `pairofcleats.apiServerUrl` points at an `http://` or `https://` PairOfCleats API server.
- `pairofcleats.apiTimeoutMs` controls API request timeout in milliseconds.
- `pairofcleats.apiExecutionMode` accepts `cli`, `prefer`, or `require`.
- `search`, symbol lookup, and index health can use the API path when the configured mode and server probe allow it.
- CLI-only workflows fail closed when `require` forces API mode onto an unsupported surface.

VS Code inline signal behavior:

- hover, file-level diagnostics, and lightweight file decorations are CLI-backed today and fail quiet when `pairofcleats.apiExecutionMode=require`
- inline surfaces use bounded context-pack requests with `--hops 0 --includeRisk --includeTypes`
- `pairofcleats.inlineHoverEnabled`, `pairofcleats.inlineDiagnosticsEnabled`, and `pairofcleats.inlineDecorationsEnabled` allow users to disable noisy inline surfaces independently
- `pairofcleats.inlineMaxItems` bounds the number of risk flows, type facts, warnings, and truncation notes shown in hover output

Repo targeting behavior:

- resolves repo context at the repo-root level, not only at the workspace-folder level
- prefers the active editor's nearest repo root when it sits inside a nested repo
- prompts for an explicit repo root when multiple local repo candidates are open and no active editor pins the target
- keeps the selected repo label visible in workflow status and persisted search result sets
- currently supports local `file:` workspaces only; remote workspace URIs fail closed with an explicit error

Operational command behavior:

- setup/bootstrap/doctor/config-dump/index-health run against the selected local repo root
- setup/bootstrap/doctor use the configured CLI resolution path
- Config Dump, Index Health and Index Validate use the configured CLI's canonical
  `config dump`, `index report` and `index validate` commands with `--json --repo`.
  The selected consumer repository supplies indexed content, not tool scripts.
- index-health uses `tools/index/report-artifacts.js --json --repo <repo>`
- code-map uses `pairofcleats report map --json --format html-iso --out ...` and opens the generated map artifact
- architecture-check uses `pairofcleats architecture-check --json --repo <repo> --rules <path>`
- impact uses `pairofcleats impact --json --repo <repo> ...` with prompted seed/changed inputs
- suggest-tests uses `pairofcleats suggest-tests --json --repo <repo> ...` with prompted changed paths
- workspace commands use `pairofcleats workspace manifest|status|build|catalog --json --workspace <path>`
- long-running workflow commands persist session metadata in workspace state, drive a status bar item keyed to the active repo context, and expose rerun/recent-workflow commands without requiring a second task runner stack

Reruns resolve the current registered command, configured CLI, repository and
transport policy. Saved executable paths remain diagnostic history. New sessions
retain bounded semantic inputs; older sessions missing required inputs are shown
as unavailable for exact replay. Workflow Status stops the displayed session by
its stable identity even if repository focus changes while the picker is open.
`apiExecutionMode=require` rejects CLI-only operator and managed workflows before
dispatch, consistently with Explain Search.

Explain Search shows the selected hit's supplied score components and captured
routing/trust facts in the PairOfCleats output view, then keeps validated source
navigation available. Reopened result entries show their captured evidence rather
than recomputing ranking. Missing components are reported as unavailable. Display
and history projection cap each breakdown at 4 KiB, query facts at 8 KiB and all
stored breakdowns in one result set at 64 KiB, with explicit truncation notes.
`searchModifiedSince` accepts an empty setting or a nonnegative safe integer;
CLI output serializes the integer while HTTP sends a JSON number, including zero.
- search runs persist normalized result sets in workspace state, populate the `PairOfCleats Results` explorer view, and support grouping by query, section, or file
- saved result-set actions support open, reveal-in-explorer, copy-path, reopen-last-results, and rerun from history
- command output is summarized in the `PairOfCleats` output channel with the raw JSON payload appended below the summary

Results explorer menus:

- the explorer title exposes search, history, reopen-last-results, and grouping commands
- result-hit context menus expose open, reveal, and copy-path actions
- result-set context menus expose rerun

Default keybindings:

- `Ctrl+Alt+F` / `Cmd+Alt+F`: `PairOfCleats: Search Selection`
- `Ctrl+Alt+.` / `Cmd+Alt+.`: `PairOfCleats: Search Symbol Under Cursor`
- `Ctrl+Alt+R` / `Cmd+Alt+R`: `PairOfCleats: Repeat Last Search`

Walkthrough/onboarding:

- the extension contributes a `Get Started with PairOfCleats` walkthrough
- walkthrough media lives under `extensions/vscode/walkthroughs/`

Packaging/publish hardening:

- `tools/package-vscode.js` validates required manifest metadata before packaging
- the VSIX must ship `README.md` and all walkthrough markdown files referenced by `package.json`
- marketplace metadata is declared directly in `extensions/vscode/package.json`
 
## Sublime package

The Sublime package source lives under `sublime/PairOfCleats` and is emitted as `dist/sublime/PairOfCleats.sublime-package`.

The archive contains plugin.py and its resources directly at the ZIP root, matching
an unpacked `Packages/PairOfCleats/` installation. Startup diagnostics explain old
lowercase/nested archives and loose files shadowing a packed revision without
deleting user files. Archive verification and copied Python imports do not qualify
actual editor installation; supported-host acceptance remains separate.

Saved searches and result sessions preserve repository, temporal selector, ANN,
sparse fallback and advanced filters. Repeat/history/context actions keep that
scope after settings or active folders change. Legacy entries without complete
scope require a new explicit search. Escape in an options picker cancels before
dispatch. Indexed completions retain the original buffer, change count, request
and replacement range; stale or superseded responses cannot edit another word.

Repository discovery selects the nearest `.pairofcleats.json`, `.git` directory,
or `.git` file. This keeps a linked Git worktree or submodule rooted at its working
directory when its metadata lives elsewhere, including inside an enclosing repo.
Multiple open worktrees still require an explicit selection for mutating commands.
