Composite context pack assembly helpers live here.

Graph neighborhood packs are implemented in `src/graph/context-pack.js`.

Native composite context-pack JSON remains authoritative. Standards-oriented exports, including the SARIF-compatible
risk-flow export, are derived renderers layered on top of the native pack. They preserve boundedness, provenance,
and truncation metadata as export properties instead of changing the native pack schema.

The shared CLI/API/MCP response boundary caps the complete serialized JSON payload
at 128 KiB, including semantic and federated sections. `maxBytes` and `maxTokens`
retain their primary-excerpt meaning. When the complete response is oversized,
optional semantic federation, risk, semantic detail, types and graph sections are
omitted in that order, with `CONTEXT_PACK_RESPONSE_BUDGET` identifying omissions.
Primary evidence is preserved. Strict risk/type evidence is never silently
discarded; a response that still exceeds the ceiling fails explicitly.
