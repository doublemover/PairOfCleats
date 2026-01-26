# Code maps

PairOfCleats can generate **code maps** from your indexed repository. A map is a graph model that can be exported as:

- **JSON** (map model)
- **Graphviz DOT** (graph definition)
- **SVG** or **HTML** (rendered via Graphviz)
- **HTML-ISO** (isometric 3D viewer powered by three.js)

The map model is derived from the same indexed metadata used for search (imports, exports, calls, usages, dataflow, etc.).

## CLI usage

Generate a map report (writes artifacts to disk and prints a JSON report):

```bash
pairofcleats report map --format json
pairofcleats report map --format dot
pairofcleats report map --format svg
pairofcleats report map --format html
pairofcleats report map --format html-iso
```

Useful options (subset):

- `--scope repo|dir|file|symbol`
- `--focus <path | folder | file::symbol>`
- `--include imports,calls,usages,dataflow,exports`
- Guardrails: `--max-files`, `--max-members-per-file`, `--max-edges`, `--top-k-by-degree`

## API server usage

When running `pairofcleats service api`, the server exposes:

- `GET /map?format=<...>`
- `GET /map/nodes`

See [docs/api/server.md](api-server.md) for details.

## Graphviz is optional

PairOfCleats can always produce **DOT** output (and the JSON map model) without Graphviz.

Graphviz is only required when you request rendered formats:

- `format=svg`
- `format=html`

If Graphviz is not installed or `dot` is not on your `PATH`, these formats will fail (or the API may downgrade to DOT when possible).

### DOT-only mode

If you do not want Graphviz installed on the same machine, you can work in "DOT-only" mode:

1) Produce DOT:

```bash
pairofcleats report map --format dot --out map.dot
```

2) Render later (any machine with Graphviz installed):

```bash
dot -Tsvg map.dot > map.svg
# or
 dot -Tpng map.dot > map.png
```

This workflow is also useful for CI environments where installing Graphviz is undesirable.

