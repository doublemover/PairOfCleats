# Editor Integration

## CLI contract for editor tooling

Editor integrations use structured JSON contracts for editor-facing workflows.

- VS Code shells out to the CLI with `--json`.
- Sublime Text shells out to the CLI for index, map, analysis, workspace, and operator workflows.
- Sublime Text can use the service API for search/symbol lookup when `api_execution_mode` allows it, and uses explicit API-only commands for server health/status surfaces.

The JSON payload includes top-level search buckets (`code`, `prose`, `extractedProse`, `records`) plus backend and optional stats/explain fields.

Indexed metadata enumeration admits only canonical filter pagination with a concrete generation and bounded opaque cursor. Continuation keeps its captured options, transport destination and repository mapping; cursor/generation/endpoint failure preserves the previous results and requires an explicit restart. Ranked text has no exhaustive continuation. Exact hit identity includes section, ID domain and value type, so numeric zero, string zero and a chunk UID are distinct. Sublime retains its selected hit across appended pages and local reopening; supported-editor focus qualification remains separate.

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

## Editor first-use guides

Use the self-contained [VS Code installation and first-search guide](../../extensions/vscode/README.md) or [Sublime Text user guide](../../sublime/PairOfCleats/README.md). They distinguish the PairOfCleats application installation from the target repository and document native commands, scoped settings, execution-host policy, bounded evidence, progress and recovery. Packaged walkthroughs link back to their bundled guide.


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
