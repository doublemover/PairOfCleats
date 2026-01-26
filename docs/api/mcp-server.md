# MCP server

PairOfCleats ships an MCP server that exposes indexing, search, and maintenance tools over JSON-RPC.

## Run
- `pairofcleats service mcp`

## Transport
- Content-Length framed JSON-RPC over stdio (vscode-jsonrpc framing + parser).
- Only stdio transport is supported; `mcp.transport` is currently ignored.
- Buffer limit defaults to 8MB. Configure via `mcp.maxBufferBytes` or `PAIROFCLEATS_MCP_MAX_BUFFER_BYTES`.
- Requests are queued (default 64). Configure via `mcp.queueMax` or `PAIROFCLEATS_MCP_QUEUE_MAX`.
  Overload responses use JSON-RPC error `-32001` with `data.code=QUEUE_OVERLOADED`.

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
- Tool responses return `result.content[0].text` as a JSON string payload.
- Long-running tools emit `notifications/progress` with `{ id, tool, message, stream, phase, ts }`.
  `id=0` is valid; only `null`/`undefined` is treated as missing.
- Errors return `isError=true` with `{ message, code, stdout, stderr, hint, timeoutMs }` when available.

## Cancellation and timeouts
- `$/cancelRequest` aborts in-flight calls by id.
- Tool timeouts default to 120s (longer for index/build/download tools). Configure via
  `mcp.toolTimeoutMs`, `mcp.toolTimeouts.<tool>`, or `PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS`.

## Notes
- Cache location defaults to the PairOfCleats cache root; override with `cache.root` or `PAIROFCLEATS_CACHE_ROOT`.
- Repo paths are auto-detected; pass explicit `repoPath` when running out-of-tree.
- JSON-RPC framing uses `vscode-jsonrpc`; LSP helpers rely on `vscode-languageserver-protocol` for symbol/position constants.
- Tool commands spawn child Node processes via `execa` with bounded stdout/stderr buffers; long-running tools stream progress lines.
