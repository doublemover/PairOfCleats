# MCP guide

PairOfCleats ships an MCP (Model Context Protocol) server that exposes indexing, search, and maintenance tools over stdio JSON-RPC.

## Modes

- `legacy` — Content-Length framed JSON-RPC (current default when SDK is unavailable).
- `sdk` — Official MCP SDK stdio transport.
- `auto` — Selects `sdk` when the SDK is available, otherwise `legacy`.

Mode selection order: CLI `--mcp-mode` → env (`MCP_MODE`/`PAIROFCLEATS_MCP_MODE`) → config `mcp.mode`.

## Run

- `node tools/mcp/server.js`
- `node tools/mcp/server.js --mcp-mode auto`
- `node tools/mcp/server.js --mcp-mode sdk`
- `node tools/mcp/server.js --mcp-mode legacy`

There is no `pairofcleats service mcp` wrapper; run the tool script directly.

## SDK availability

SDK mode requires `@modelcontextprotocol/sdk` (optional dependency). If it is not installed, SDK mode will exit with a clear error.

## Capabilities and versions

`initialize` responses include:
- `protocolVersion`
- `schemaVersion`
- `toolVersion`
- `capabilities.experimental.pairofcleats` (effective capability flags)

Canonical tool schemas live at `docs/contracts/mcp-tools.schema.json`.

## Errors

Tool failures return `isError=true` with a JSON payload containing:
- `code`
- `message`
- optional `stderr`, `stdout`, `timeoutMs`, `exitCode`, `hint`

The canonical error registry is `docs/contracts/mcp-error-codes.md`.

## Cancellation and timeouts

- `$/cancelRequest` cancels in-flight tool calls.
- Tool timeouts default to 120s (longer for build/download tools).
  Configure via `mcp.toolTimeoutMs`, `mcp.toolTimeouts.<tool>`, or `PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS`.
- Queue limit defaults to 64; configure via `mcp.queueMax` or `PAIROFCLEATS_MCP_QUEUE_MAX`.

## Tool list

See `docs/contracts/mcp-tools.schema.json` or `tools/list` for the current tool set.
