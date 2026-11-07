# LSIF ingest

Use the LSIF ingest tool to import LSIF JSONL graphs into normalized symbol occurrences.

## CLI

```bash
pairofcleats ingest lsif --repo . --input dump.lsif

node tools/ingest/lsif.js --repo . --input dump.lsif

# Or via npm
pairofcleats ingest lsif --repo . --input dump.lsif

# Read from stdin
cat dump.lsif | node tools/ingest/lsif.js --repo . --input -
```

## Options

- `--repo`: repo root used to resolve paths and the cache root (defaults to auto-detected repo root).
- `--input`: LSIF JSONL file path or `-` for stdin (stdin is used when omitted).
- `--out`: output JSONL path (default: `<cacheRoot>/lsif/lsif.jsonl`).
- `--json`: emit the summary JSON to stdout instead of status lines.

## Output

- JSONL entries include: `file`, `ext`, `name`, `kind`, `startLine`, `endLine`, `startChar`, `endChar`, `role`, `language`.
- `<output>.meta.json`: summary with `generatedAt`, `repoRoot`, `input`, `output`, and `stats` (vertices, edges, definitions, references, errors, kinds, languages).

## Notes

- The ingest expects LSIF JSONL with `vertex` and `edge` records.
- An `item` edge points from a result vertex (`outV`) to range vertices
  (`inVs`). Definition results emit definitions. Reference-result properties
  distinguish `definitions` and `references`; declarations retain `role=other`.
- Document containment owns each range's path. Document-valued `shard` and
  legacy `document` hints support older dumps and navigation `resultRange`
  vertices; project shards require actual document containment. Conflicting
  document witnesses and invalid positions are rejected and counted in `errors`.
- Shared result sets and result-to-result/reference links add no synthetic
  locations. Concrete occurrences are emitted once per location and role.
  Moniker links to other dumps need a cross-dump database for resolution.
- `tag.text` and `tag.kind` supply the name and symbol kind when present.
  Real file URIs use native file-URL decoding (including drives, spaces, Unicode
  and escaped percent signs); `/repo/...` remains the supported virtual root.
  Non-file URIs, out-of-repository authorities and encoded-separator escapes cannot add
  local occurrences.

The [Microsoft LSIF specification](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsif/0.6.0/specification.md)
defines item direction, result properties, containment, sharding and range tags.
