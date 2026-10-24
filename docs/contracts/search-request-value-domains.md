# Search request value domains

Status: UNVALIDATED source and authored corpus, 2026-10-22.

HTTP and MCP search properties use the same search-request-schema owner next to
the canonical request model and argument builder. Path/file/extension filters
accept strings or string arrays. Metadata retains the existing HTTP scalar/list/
object forms; metaJson retains JSON value forms. Backend selection advertises
auto, memory, sqlite, sqlite-fts and lmdb. Top and count/recency bounds are
nonnegative integers; the deprecated context input remains exactly zero. MCP
argument construction now preserves top:0 instead of silently changing it to1.
Existing query-or-effective-filter admission and canonical CLI validation remain.

MCP descriptions remain transport-specific prose over shared types. HTTP retains
its repo compatibility alias and compact/json/full output modes; MCP retains
repoPath and compact/full output modes because it already transports JSON.
These exceptions are explicit and authored in the value-domain parity corpus.
Each property factory returns independent schemas; validator cloning remains.

This repairs advertised value domains and zero argument parity, without claiming
that the direct argument helper is a general JSON-Schema validator. Original
unknown-field, invalid context, cursor/query and CLI predicate negatives remain.
Actual advertised MCP schema, HTTP validator, shared builder and canonical CLI
fixtures cover lists, metadata, backends, integer bounds, absent/null/zero and the
intentional transport differences. They have not executed.

The MCP schema snapshot is now at 1.10.0, including these value domains and later
context/semantic contract changes. Regenerate it with
`node tools/docs/generated-surfaces.js --refresh --surface mcp-tool-schema`;
the shared freshness gate compares it with the authoritative definitions.
Source declarations and a fresh snapshot do not qualify MCP clients, backends
or final-head acceptance.
