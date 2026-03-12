Composite context pack assembly helpers live here.

Graph neighborhood packs are implemented in `src/graph/context-pack.js`.

Native composite context-pack JSON remains authoritative. Standards-oriented exports, including the SARIF-compatible
risk-flow export, are derived renderers layered on top of the native pack. They preserve boundedness, provenance,
and truncation metadata as export properties instead of changing the native pack schema.
