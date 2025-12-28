# Phase 12: MCP Server Packaging

## Scope
Provide an MCP stdio server that manages per-repo index lifecycle and search.

## Tool Surface
- `index_status`: repo identity, git info, cache/index presence, dictionaries/models.
- `build_index`: build JSON and optional SQLite indexes (incremental supported).
- `search`: run index-backed queries with JSON results.
- `download_models`: prefetch embeddings into the shared cache.
- `report_artifacts`: cache/index size summary (JSON).

## Implementation Notes
- Uses JSON-RPC 2.0 over stdio with LSP-style `Content-Length` framing.
- Each tool runs the existing CLI scripts with `cwd` set to the target repo.
- Git is optional; when missing, the server returns a warning but proceeds.

## Example Usage
```bash
npm run mcp-server
```

Clients should call `initialize`, then `tools/list` and `tools/call`.
