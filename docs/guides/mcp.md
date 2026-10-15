# MCP guide

PairOfCleats ships an MCP (Model Context Protocol) server that exposes indexing, search, and maintenance tools over stdio JSON-RPC.

## Modes

- `legacy` — Content-Length framed JSON-RPC compatibility transport (current default).
- `sdk` — Official MCP SDK stdio transport.
- `auto` — Selects `sdk` when the SDK is available, otherwise `legacy`.

Mode selection order: CLI `--mcp-mode` → env (`MCP_MODE`/`PAIROFCLEATS_MCP_MODE`) → config `mcp.mode` → `legacy`.

## Run

- `node tools/mcp/server.js`
- `node tools/mcp/server.js --mcp-mode auto`
- `node tools/mcp/server.js --mcp-mode sdk`
- `node tools/mcp/server.js --mcp-mode legacy`
- `pairofcleats service mcp --mcp-mode sdk`
- `node bin/pairofcleats.js service mcp --mcp-mode auto`

The service wrapper dispatches through `tools/mcp/cli-entry.js` to the same server.

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

- Legacy `$/cancelRequest` cancels queued or in-flight tool calls.
- SDK clients use standard `notifications/cancelled`; disconnect also cancels
  request work. A cancelled queued call never starts. Running cancellation and
  deadlines retain the queue slot until the tool and its owned subprocess cleanup
  settle, preventing overlap with work that is still tearing down.
- A configured subprocess kill grace also retains that slot through the shared
  process-tree owner's escalation. Termination receipts distinguish observed
  direct-child closure from settled tree cleanup; escalation alone does not
  certify that every descendant has been reaped.
- SDK progress uses request `notifications/progress` with a string or numeric
  token (including zero), increasing numeric event count and message. A slow
  transport coalesces pending updates; the count is not a percentage. Notification
  failures are caught and progress closes before the terminal tool result.
- Tool timeouts default to 120s (longer for build/download tools).
  Configure via `mcp.toolTimeoutMs`, `mcp.toolTimeouts.<tool>`, or `PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS`.
- Queue limit defaults to 64; configure via `mcp.queueMax` or `PAIROFCLEATS_MCP_QUEUE_MAX`.

## Tool list

See `docs/contracts/mcp-tools.schema.json` or `tools/list` for the current tool set.
