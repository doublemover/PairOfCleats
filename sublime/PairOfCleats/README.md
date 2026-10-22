# PairOfCleats Sublime Text

PairOfCleats integration for Sublime Text 3.

## Install

1. Install the CLI from the [source checkout](../../README.md#quickstart), using
   Node.js **>=26.12.1 <27** and `npm run bootstrap:ci` with development dependencies.
2. Copy or symlink `sublime/PairOfCleats` into your Sublime `Packages` directory.
3. Run `PairOfCleats: Open Settings` and set `pairofcleats_path` to the absolute path
   of that checkout's `bin/pairofcleats.js`. Set `node_path` if the required Node
   executable is not the one available on PATH.
4. Build the target project's index using the [first-search guide](../../docs/guides/first-search.md),
   then use `PairOfCleats: Search` from your open project.

The package is currently private; these instructions do not assume a published
global npm package or a globally linked CLI command. CLI/Node paths belong in
User Settings rather than `.sublime-project` overrides.

## Package Control notes

The plugin supports Sublime Text 3's embedded Python 3.3; checkout setup still
requires the separately documented Python/native build toolchain. Windows stop
uses a bounded compatible subprocess helper and retains direct termination and
force-stop escalation when that helper fails. Folder-watch containment checks
path components, including sibling-prefix and different-drive rejection.

This package avoids external Python dependencies. It relies on the Node runtime
and the PairOfCleats CLI or local repo binaries.

## CLI discovery

Resolution order:
1) The configured `pairofcleats_path` from User Settings
2) `pairofcleats` on PATH, only when no path is configured

The plugin does not discover a CLI executable from the open repository's
`node_modules/.bin` or `bin` directory. An absolute configured path is the least
ambiguous choice; a relative configured path resolves against the selected repo.

If the selected path ends in `.js`, the plugin runs it with `node_path` (or `node`).

## Settings

Open the command palette and run:
- `PairOfCleats: Open Settings`
- `PairOfCleats: Open Project Settings`
- `PairOfCleats: Project Settings Template`
- `PairOfCleats: Show Effective Settings`
- `PairOfCleats: Validate Settings`

Core:
- `pairofcleats_path`: Path to the CLI binary or `bin/pairofcleats.js`.
- `node_path`: Optional override for the Node.js binary.
- `index_mode_default`: `code`, `prose`, `both`, `records`, `extracted-prose`, or `all`.
- `search_backend_default`: `auto`, `memory`, `sqlite`, `sqlite-fts`, `lmdb`, or CLI-only `tantivy`. The API rejects backends it does not admit.
- `search_limit`: Default `--top` value.
- `search_prompt_options`: Prompt for mode/backend/limit each search.
- `history_limit`: Maximum queries stored per project.

API:
- Success and error response bodies have a 20 MiB byte ceiling before decoding.
  An oversized response is closed and reported as `api-response-too-large`;
  narrow the request or reduce result volume. HTTP error text and overflow
  previews contain at most 4,096 characters.
- `api_server_url`: Base URL for API-backed workflows.
- Authenticated servers use `PAIROFCLEATS_API_TOKEN` from User Settings `env`,
  falling back to the editor process environment. Credentials are sent only to
  the origin configured by the user in `api_server_url` (scheme, host and port).
  Project settings and caller-provided workflow settings cannot approve another
  destination or override the token. Credential-bearing redirects are refused,
  including redirects within the same origin; use the final API URL directly.
- `api_timeout_ms`: Timeout for API requests in milliseconds.
- `api_execution_mode`: `cli`, `prefer`, or `require`.
  - `search` and symbol-driven navigation/completion can use the API path.
  - `map`, context/risk/architecture/impact/suggest/workspace workflows remain CLI-only; `require` fails closed for those commands.
  - `Server Health`, `Server Status`, and `Index Health` are explicit API-only commands and require `api_server_url` regardless of `api_execution_mode`.

Output:
- `open_results_in`: `quick_panel`, `new_tab`, or `output_panel`.
- `results_buffer_threshold`: When using `quick_panel`, switch to the output panel once results reach this count (`0` disables).
- `progress_panel_on_start`: Automatically show the structured task-progress panel when long-running work starts.
- `progress_watchdog_ms`: Soft watchdog interval for quiet long-running commands before the progress panel records a no-progress warning.

Watch:
- `index_watch_scope`: `repo` or `folder` for watch root selection.
- `index_watch_folder`: Optional folder path (absolute or repo-relative) when using `folder` scope.
- `index_watch_mode`: `all`, `code`, `prose`, `records`, or `extracted-prose`.
- `index_watch_poll_ms`: Watch polling interval in ms (when polling is enabled).
- `index_watch_debounce_ms`: Debounce interval for watch rebuilds (ms).

Map:
- `map_type_default`: `combined`, `imports`, `calls`, `usages`, or `dataflow`.
- `map_format_default`: `html-iso`, `html`, `svg`, `dot`, or `json`.
- `map_prompt_options`: Prompt for map type/format each run.
- `map_output_dir`: Output directory for map artifacts (absolute or repo-relative).
- `map_only_exported`: When true, include exported symbols only.
- `map_collapse_default`: `none`, `file`, or `dir`.
- `map_max_files`: Guardrail for file nodes.
- `map_max_members_per_file`: Guardrail for members per file.
- `map_max_edges`: Guardrail for edges.
- `map_top_k_by_degree`: Prefer top-k files by edge degree when truncating.
- `map_show_report_panel`: `true`, `false`, or `null` to control map summary panel behavior.
- `map_stream_output`: Stream CLI output to the map panel.
- `map_open_uri_template`: URI template for the isometric viewer (Sublime links).
- `map_three_url`: Override three.js module path (default resolves from node_modules).
- `map_index_mode`: Index mode to read (`code` or `prose`).
- `map_wasd_sensitivity`: Isometric viewer WASD sensitivity.
- `map_wasd_acceleration`: Isometric viewer WASD acceleration.
- `map_wasd_max_speed`: Isometric viewer WASD max speed.
- `map_wasd_drag`: Isometric viewer WASD damping.
- `map_zoom_sensitivity`: Isometric viewer zoom sensitivity.

Environment:
- `env`: Extra environment values (for `PAIROFCLEATS_API_TOKEN`, etc.).

## Commands

- `PairOfCleats: Open Settings`
- `PairOfCleats: Open Project Settings`
- `PairOfCleats: Show Effective Settings`
- `PairOfCleats: Validate Settings`
- `PairOfCleats: Show Config Dump`
- `PairOfCleats: Tooling Doctor`
- `PairOfCleats: Server Health`
- `PairOfCleats: Server Status`
- `PairOfCleats: Index Health`
- `PairOfCleats: Search`
- `PairOfCleats: Search (With Options)`
- `PairOfCleats: Search Selection`
- `PairOfCleats: Search Symbol Under Cursor`
- `PairOfCleats: Search History`
- `PairOfCleats: Repeat Last Search`
- `PairOfCleats: Explain Search`
- `PairOfCleats: Index Build (Code)`
- `PairOfCleats: Index Build (Prose)`
- `PairOfCleats: Index Build (All)`
- `PairOfCleats: Index Watch Start`
- `PairOfCleats: Index Watch Stop`
- `PairOfCleats: Index Validate`
- `PairOfCleats: Open Index Directory`
- `PairOfCleats: Map (Repo)`
- `PairOfCleats: Map (Current Folder)`
- `PairOfCleats: Map (Current File)`
- `PairOfCleats: Map (Symbol Under Cursor)`
- `PairOfCleats: Map (Selection)`
- `PairOfCleats: Map Jump to Node`
- `PairOfCleats: Map Open Last Viewer`
- `PairOfCleats: Map Show Last Report`

## Project overrides

In your `.sublime-project` file:

```json
{
  "settings": {
    "pairofcleats": {
      "open_results_in": "output_panel",
      "index_watch_scope": "folder",
      "index_watch_folder": "./src",
      "map_stream_output": true
    }
  }
}
```

Supported project presentation/index options replace base settings key-for-key.
CLI/Node paths, API connection/execution settings and environment values come
from User Settings; project values for those fields do not take effect.
`cli_args` and `extra_search_args` are not supported settings in this plugin.
The effective-settings panel distinguishes applied, ignored and unsupported
project keys.
Use `PairOfCleats: Show Effective Settings` to inspect the final merged settings for the current window.
Use `PairOfCleats: Project Settings Template` to open a copy/paste starter payload for `.sublime-project`.

## CLI output contract

Subprocess and API requests belong to their source window. Closing a window,
unloading the plugin or changing project context cancels owned work and prevents
late panels, history updates and navigation. Shutdown waits for bounded resource
settlement and reports unconfirmed cleanup instead of equating cleared task UI
with terminated processes. A newer foreground search supersedes earlier work
only in the same window. Native host disable/update/uninstall and process-tree
qualification remain separate from the authored lifecycle fixtures.

The Sublime integration is designed to use `--json` output so it can access full
metadata when available. It does not assume the compact JSON contract used by
other editors.

Risk Explain resolves chunk, file and symbol seeds through the canonical context-pack
code-generation owner. Editor requests and exported results retain repository, mode,
concrete index directory and index signature. Stale repo-local index-code artifacts
do not provide a fallback. Saved qualified requests remain pinned; if that generation
or chunk is unavailable, run the current command deliberately to choose current evidence.

## Selected repositories and bounded evidence

Use **Select Repository** / **Clear Selected Repository** to switch a window's read-only target without editing its project or starting an index. Ambiguous multi-root searches and **Show Effective Settings** offer the same target choice. Removed roots are discarded. The effective-settings panel shows target, source of each supported override and corrections; runtime, API and environment authority stays in User Settings and secrets/arguments are redacted.

**Browse Indexed Matches** deliberately admits an empty query plus an effective filter. **Load More Indexed Matches** reuses frozen options and generation identity, appends exact IDs without merging spelling collisions, and stops at the 2,000 hit view bound. Restart after a generation/cursor error. Ranked text results remain top-k; ordinary empty/cancelled search prompts still do nothing.

Goto Definition / Find References use the shared navigation consumer with saved-source SHA-256, document version and one-based UTF-16 cursor coordinates. Dirty or stale sources do not produce precise indexed joins. Ambiguous candidates can be inspected without pooling references. **Related Search (Approximate)** retains the ranked-search fallback under an honest label. Qualified source selections retain start/end columns, including Unicode and multiline spans; unsupported generated/byte mappings remain explicit.

**Semantic Evidence (Experimental)** resolves the first-use current saved cursor through the canonical local navigation owner, then offers its exact target/generation or source/structural/type/literal selectors. Generation discovery in CLI/API mode reads the canonical selected-source context section; explicit immutable `baseBuildId` entry remains available when discovery is unsupported. Git revisions and status paths do not become semantic generation IDs. Type queries select declared/compiler sources and roles; scalar types include empty strings, boolean, null, finite numbers and bigint. Numeric input is the exact recorded decimal representation, with no bigint `n` suffix. Generation, refs, extraction/analysis/response coverage and stopped-frontier warnings remain visible. Requests retain 128-record, 512-edge, 64 KiB and 250 ms bounds where applicable; native panels choose depth 1–64, edge kinds and optional slot/ordinal. API menus offer advertised operations. Persistent API sessions offer bounded More; CLI cursors expire with their process. Enrichment exposes planning only, and empty/partial output is never proof of no flow.

Exact source opening verifies original disk-byte identity and the actual loaded buffer. Observed BOM removal and CRLF-to-LF normalization preserve line/UTF-16 column mapping; ranges crossing a removed BOM or unsupported byte/generated mappings remain unavailable. Other buffer changes never reuse indexed ranges.

The original-byte verifier is bounded to 4 MiB and rechecks source identity after loading. Precise columns outside a line or inside a surrogate pair are refused. Deferred source selection stops when its window/context is invalidated or a newer source-opening action supersedes it; loading has a five-second selection deadline. Evidence selection and purpose/save inputs keep their original operation lifetime, so a late native callback cannot start a new request or write after context replacement. Semantic operation failures retain the prior evidence picker without automatically replaying the request.

In local CLI mode, **Semantic Evidence** rechecks file bytes, buffer version and cursor selection before Find. Ambiguous/partial or changed cursor evidence retains a source/structural selector instead of a unique target. Generation discovery is read-only and bounded: 8 KiB primary context, graph/risk expansion disabled, and the canonical semantic section keeps its existing limits. Subsequent operations preserve that returned generation.

From a search/context/risk hit action, **Create Context from This Evidence**, or use **Copy / Export Selected Context** for up to eight seeds. The native keyboard picker toggles items, previews canonical packets, allows exclusions, and deliberately copies/saves JSON or Markdown. Each packet uses a 24 KiB context budget and the export is bounded to 256 KiB. JSON is an array of unchanged canonical packets; purpose and omission notes are in Markdown. Actual byte size is shown; token estimates are unavailable. Current/indexed distinctions, generation/source provenance, confidence, truncation and incomplete-frontier warnings are retained. Collection captures current indexed context and does not certify an older result generation. Export requires an explicit destination and never transmits to an agent.

**Inspect Tasks** identifies exact repository/operation IDs and offers the selected task's bounded log tail (up to 128 lines and 64 KiB), cancellation and registered diagnostics. Eight recent completed observations retain logs without process callbacks. Settings target the selected task's repository; doctor/health actions explicitly use the current repository. A failed build offers a deliberate retry with mode/repository selection, except when process-tree cleanup remains unconfirmed. Structured `poc.progress@2` events supply stages and bounded counters; quiet/missing phases stay indeterminate. Cancellation waits for owned process/HTTP settlement; timeout, cleanup uncertainty and errors remain failures even after a requested stop or zero exit. Starting another watch requires the prior owned watch and termination helper to settle, followed by a deliberate start. There is no automatic destructive rebuild/restart.

**Show Effective Settings** includes a native **Inspect Installation / Transport Evidence** action. It observes CLI/runtime versions through the configured User-owned installation, and service capabilities only for an API policy. Each version observation has a three-second/8 KiB output bound; no installation, dependency setup or build runs. Missing or malformed identities stay unobserved, and settings/doctor recovery actions remain registered native commands.

Typed index-watch lifecycle frames can show **idle-watch**, indexing and degraded states. Idle requires admitted watcher, quiescence and no queued/replay work. Watcher admission, a canonical publication commit/build ID and search readiness are separate observations; search/backend readiness remains unknown. A typed degraded state retains its reason/code and publication evidence until the watch owner explicitly recovers. Terminal ownership failures are observed even after UI publication is revoked; they do not create late result panels, successful cancellation, automatic replacement or saved-PID authority.

**Select Service Repository** separates the API host's repository path from this editor's local checkout. `/status` must admit that service root and report a matching Git revision with clean service source; editor worktree freshness remains unverified. Paths are mapped using service-host path rules and traversal is rejected. Non-Git identities require local CLI or another qualified workflow. Sublime has no automatic SSH/WSL/container shell transport: run a compatible CLI on the host where Sublime executes, or deliberately select supported API operations. `require` never silently switches to CLI. Connection recovery does not replay mutations or change binds/credentials.
