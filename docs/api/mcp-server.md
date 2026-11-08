# MCP server

PairOfCleats ships an MCP server that exposes indexing, search, and maintenance tools over JSON-RPC.

## Run
- `node tools/mcp/server.js --mcp-mode <legacy|sdk|auto>`
- `pairofcleats service mcp --mcp-mode <legacy|sdk|auto>`
- From a checkout: `node bin/pairofcleats.js service mcp --mcp-mode sdk`

Mode selection order: CLI `--mcp-mode` → env (`PAIROFCLEATS_MCP_MODE`) → config `mcp.mode`.
Default mode is `legacy` unless `auto` is explicitly requested.
`auto` selects SDK mode when `@modelcontextprotocol/sdk` is available, otherwise legacy.

## Transport
- **SDK mode**: official MCP SDK stdio transport.
- **Legacy mode**: compatibility Content-Length framed JSON-RPC over stdio (vscode-jsonrpc framing + parser).
- Only stdio transport is supported; `mcp.transport` is currently ignored.
- Buffer limit defaults to 8MB. Configure via `mcp.maxBufferBytes` or `PAIROFCLEATS_MCP_MAX_BUFFER_BYTES`.
  Both transports enforce the configured input bound. Zero explicitly disables
  the bound; an omitted or blank environment value leaves configured precedence
  intact. Negative, fractional and non-finite limits are invalid.
- Requests are queued (default 64). Configure via `mcp.queueMax` or `PAIROFCLEATS_MCP_QUEUE_MAX`.
  The legacy JSON-RPC transport reports overload as error `-32001` with
  `data.code=QUEUE_OVERLOADED`. SDK tool transport reports `isError=true` and a
  JSON text content item whose `code` is `QUEUE_OVERLOADED`. Check the envelope
  before reading a successful tool result. `normalizeMcpToolResponse` from
  `src/integrations/mcp/result-envelope.js` accepts both forms. Its `retryable`
  field identifies queue rejection; it never retries or replays a request.
- SDK mode gives `index_status` and `config_status` one diagnostic execution lane,
  independent of the single lane for all other tools. A short configured timeout
  cannot promote a mutating SDK tool. Both lanes share the existing queue limit;
  with capacity greater than one, each class reserves one admission slot for the
  other. Flooding either class cannot consume all of the other's headroom.
  Capacity one uses a single shared execution queue and rejects a status request
  while that sole slot is occupied. Explicitly disabled queue bounds retain their
  existing behavior. Legacy mode retains its existing status/short-timeout fast
  classification and diagnostic reservation.

## Classifying overload and tool failures

Legacy transport uses a JSON-RPC error; SDK tool transport uses a failed tool
result inside an otherwise successful JSON-RPC response:

```json
{"jsonrpc":"2.0","id":7,"error":{"code":-32001,"message":"Tool queue is full.","data":{"code":"QUEUE_OVERLOADED"}}}
{"jsonrpc":"2.0","id":7,"result":{"isError":true,"content":[{"type":"text","text":"{\"code\":\"QUEUE_OVERLOADED\",\"message\":\"Tool queue is full.\"}"}]}}
```

Both classify as code `QUEUE_OVERLOADED`. The typed helper also accepts a direct
SDK CallToolResult, preserves unknown error codes and malformed text as failures,
and rejects malformed/conflicting envelopes. It classifies tool responses rather
than arbitrary initialize/ping results. For example:

```ts
import { normalizeMcpToolResponse } from '../../src/integrations/mcp/result-envelope.js';

function classifyToolResponse(response: unknown) {
  const outcome = normalizeMcpToolResponse(response);
  if (!outcome.ok) {
    return { state: outcome.code === 'QUEUE_OVERLOADED' ? 'admission-rejected' : 'failed',
      code: outcome.code, message: outcome.message, details: outcome.details };
  }
  return { state: 'completed', result: outcome.result };
}
```

The helper's `retryable` field identifies queue admission rejection; it performs no
retry. `TOOL_TIMEOUT`, cancellation and transport loss are separate outcomes and
do not establish that mutating work had no effects. Inspect operation state and
idempotency before deciding whether to submit it again; do not automatically
replay every failed or disconnected tool call.

The actual transport/classifier fixture exercises success, failed execution,
overload, invalid parameters, unknown methods, timeout and cancellation in both
modes. Unknown methods retain JSON-RPC `-32601`; a mode need not attach the same
application code to that protocol rejection. Legacy cancellation delivers a
`CANCELLED` failed tool result. The locked SDK's registered handler also produces
that failed tool result, but its protocol layer suppresses a response after a
client cancellation notification. Classify a delivered result or the SDK client's
cancellation outcome at its own boundary; absence of a response is not proof that
mutating work never ran. Both transports retain admission until original tool
execution and cleanup settle.

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
- `initialize` responses include `schemaVersion`, `toolVersion`, and a capabilities payload under `capabilities.experimental.pairofcleats`.
- Legacy long-running tools emit `notifications/progress` with `{ id, tool, message, stream, phase, ts }`.
  SDK notifications carry `{ progressToken, progress, message }`; string and numeric
  tokens, including zero, are accepted. Numeric progress counts events, and slow
  transports coalesce pending updates. Neither count implies percentage completion.
- Errors return `isError=true` with `{ message, code, stdout, stderr, hint, timeoutMs }` when available.

## Cancellation and timeouts

Service shutdown aborts queued and running SDK requests and awaits owned teardown.
A transport close failure remains an error after the queue has drained; it cannot
release running capacity or produce an apparently successful shutdown early.
SDK shutdown waits for both execution lanes, including cancelled running tools
still finishing owned cleanup. Internal bounded scheduler snapshots distinguish
monotonic queue wait from combined tool execution/cleanup time; they retain at
most 32 compact settlement observations and never imply successful tool work or
a percentage/latency guarantee. Existing response/error envelopes are unchanged.
- Legacy `$/cancelRequest` cancels queued/in-flight calls by id. SDK uses standard
  `notifications/cancelled`; transport closure or stdin EOF also cancels work.
- SDK queue capacity is held until the actual tool and owned subprocess cleanup
  settle. Cancelled queued calls never execute, and terminal calls emit no later
  progress or success.
- Tool timeouts default to 120s (longer for index/build/download tools). Configure via
  `mcp.toolTimeoutMs`, `mcp.toolTimeouts.<tool>`, or `PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS`.

## Error codes and troubleshooting
PairOfCleats uses the shared error code registry in `docs/contracts/mcp-error-codes.md`.
Common cases:
- `QUEUE_OVERLOADED`: admission was rejected because the tool queue is full; reduce concurrent submissions.
- `INVALID_REQUEST`: payload validation failed; check required fields and types.
- `INTERNAL`: unexpected failure; check server logs for details.

## Notes
- Cache location defaults to the PairOfCleats cache root; override with `cache.root` or `PAIROFCLEATS_CACHE_ROOT`.
- Repo paths are auto-detected; pass explicit `repoPath` when running out-of-tree.
- JSON-RPC framing uses `vscode-jsonrpc`; LSP helpers rely on `vscode-languageserver-protocol` for symbol/position constants.
- Tool commands use the shared subprocess runner with owned process-tree cleanup
  and bounded stdout/stderr buffers; long-running tools stream progress lines.
