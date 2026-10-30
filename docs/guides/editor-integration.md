# Editor Integration

## CLI contract for editor tooling

Editor integrations use structured JSON contracts for editor-facing workflows.

- VS Code shells out to the CLI with `--json`.
- Sublime Text shells out to the CLI for index, map, analysis, workspace, and operator workflows.
- Sublime Text can use the service API for search/symbol lookup when `api_execution_mode` allows it, and uses explicit API-only commands for server health/status surfaces.

The JSON payload includes top-level search buckets (`code`, `prose`, `extractedProse`, `records`) plus backend and optional stats/explain fields.

Indexed metadata enumeration admits only canonical filter pagination with a concrete generation and bounded opaque cursor. Continuation keeps its captured options, transport destination and repository mapping; cursor/generation/endpoint failure preserves the previous results and requires an explicit restart. Ranked text has no exhaustive continuation. Exact hit identity includes section, ID domain and value type, so numeric zero, string zero and a chunk UID are distinct. Sublime retains its selected hit across appended pages and local reopening; supported-editor focus qualification remains separate.

Both adapters admit initial page membership before publishing history/results:
returned counts must match the captured rows, known totals must cover that page,
and an advancing page must contain a result. Invalid pages retain the prior view.
VS Code assigns stable native TreeItem IDs to result sets, grouping rows and hit
occurrences, including duplicate canonical IDs and anonymous captured ordinals.
These IDs preserve display identity across refresh/grouping and appended pages;
they are never semantic/source authority. Real editor focus/expansion acceptance
and the authored initial-page/identity regressions remain unvalidated.

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
- Sublime resources directly at the ZIP root; VS Code resources under `extension/`
- fixed archive metadata (`mtime`, mode bits)
- per-archive SHA-256 output and JSON manifest

See `docs/specs/editor-packaging-determinism.md` for contract details.

## Editor first-use guides

Use the self-contained [VS Code installation and first-search guide](../../extensions/vscode/README.md) or [Sublime Text user guide](../../sublime/PairOfCleats/README.md). They distinguish the PairOfCleats application installation from the target repository and document native commands, scoped settings, execution-host policy, bounded evidence, progress and recovery. Packaged walkthroughs link back to their bundled guide.

## VS Code settings reference

The extension's Settings UI supplies defaults and accepted values. Executable,
environment and service-destination authority belongs in User Settings; search
and presentation settings follow the selected repository resource. The canonical
[editor contract](../../src/contracts/editor-config-contract.json) and extension
manifest define these names:

- `pairofcleats.cliPath`: installed CLI executable or JavaScript entrypoint.
- `pairofcleats.nodePath`: Node executable for a JavaScript CLI entrypoint.
- `pairofcleats.cliArgs`: installation-level CLI arguments.
- `pairofcleats.apiServerUrl`: selected service destination.
- `pairofcleats.apiTimeoutMs`: service request deadline.
- `pairofcleats.apiExecutionMode`: CLI, preferred API, or required API transport.
- `pairofcleats.env`: explicit environment overrides for owned commands.
- `pairofcleats.extraSearchArgs`: additional search arguments.
- `pairofcleats.searchMode`: indexed content mode.
- `pairofcleats.searchBackend`: retrieval backend.
- `pairofcleats.searchAnn`: approximate-nearest-neighbor selection.
- `pairofcleats.maxResults`: result count limit.
- `pairofcleats.searchFile`: file selector.
- `pairofcleats.searchPath`: path selector.
- `pairofcleats.searchLang`: language selector.
- `pairofcleats.searchExt`: extension selector.
- `pairofcleats.searchType`: chunk type selector.
- `pairofcleats.searchAsOf`: temporal selector.
- `pairofcleats.searchSnapshot`: saved snapshot selector.
- `pairofcleats.searchFilter`: structured filter expression.
- `pairofcleats.searchAuthor`: author selector.
- `pairofcleats.searchModifiedAfter`: modification timestamp lower bound.
- `pairofcleats.searchModifiedSince`: relative modification selector.
- `pairofcleats.searchChurn`: churn selector.
- `pairofcleats.searchCaseSensitive`: case-sensitive search selection.
- `pairofcleats.inlineHoverEnabled`: inline hover presentation.
- `pairofcleats.inlineDiagnosticsEnabled`: inline diagnostic presentation.
- `pairofcleats.inlineDecorationsEnabled`: inline decoration presentation.
- `pairofcleats.inlineMaxItems`: inline item limit.


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

VS Code exact source locations bind both the requested URI and the actually
opened document URI to the verified local file. Equal text in a sibling or
virtual document cannot establish that binding; closed documents cannot supply
native ranges. Final publication rechecks the actual document URI and the
per-request cache includes the selected repository root. These source assertions
are authored and unrun, with supported editor-host acceptance still separate.

Sublime exact highlighting likewise retains the originally requested file through
native opening/loading and binds the returned view to that file. Identical-text
sibling or scratch views cannot supply the original location. A delayed action
retains copied original hit fields and refuses a renamed view or replaced context
before changing its selection/highlight. These native-consumer controls remain
authored and unrun; line-only legacy highlighting retains its existing approximate
behavior.

Repository discovery selects the nearest `.pairofcleats.json`, `.git` directory,
or `.git` file. This keeps a linked Git worktree or submodule rooted at its working
directory when its metadata lives elsewhere, including inside an enclosing repo.
Multiple open worktrees still require an explicit selection for mutating commands.
