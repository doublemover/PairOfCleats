# MCP server

PairOfCleats ships an MCP server that exposes indexing, search, and maintenance tools over JSON-RPC.

## Run
- `pairofcleats service mcp`

## Transport
- Current transport: legacy JSON-RPC over stdio (`vscode-jsonrpc` framing).
- `mcp.transport` accepts `auto|legacy|sdk`; SDK transport is planned but not
  wired yet. If you set `sdk`, ensure `@modelcontextprotocol/sdk` is installed
  to avoid capability warnings.

## Tools
- `index_status`
- `config_status`
- `build_index`
- `build_sqlite_index`
- `compact_sqlite_index`
- `search`
- `triage_ingest`
- `triage_decision`
- `triage_context_pack`
- `download_models`
- `download_dictionaries`
- `download_extensions`
- `verify_extensions`
- `cache_gc`
- `clean_artifacts`
- `bootstrap`
- `report_artifacts`

## Output
- `search` defaults to compact JSON payloads. Use `output: "full"` in params to return full JSON.
- Long-running tools emit `notifications/progress` with `{ id, tool, message, stream, phase }`.
- Errors return `isError=true` with `{ message, code, stdout, stderr, hint }` when available.

## Notes
- Cache location defaults to the PairOfCleats cache root; override with `cache.root` or `PAIROFCLEATS_CACHE_ROOT`.
- Repo paths are auto-detected; pass explicit `repoPath` when running out-of-tree.
- JSON-RPC framing uses `vscode-jsonrpc`; LSP helpers rely on `vscode-languageserver-protocol` for symbol/position constants.
- Tool commands spawn child Node processes via `execa` with bounded stdout/stderr buffers; long-running tools stream progress lines.
