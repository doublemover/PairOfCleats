# GNU Global (GTAGS) Ingest

PairOfCleats can ingest GNU Global tag output as a fallback symbol source when
LSP/SCIP/LSIF/ctags are unavailable. The ingest tool converts `global -x` output
into JSONL for downstream indexing or analysis.

CLI
```bash
# Run global -x inside the repo
node tools/gtags-ingest.js --repo /path/to/repo --run

# Ingest from a file
node tools/gtags-ingest.js --repo /path/to/repo --input gtags.txt --out gtags.jsonl
```

Output
- JSONL entries include: `file`, `name`, `startLine`, `endLine`, `role`, `source`.
- A `.meta.json` summary is written next to the output file.

Notes
- The tool expects `global -x` format: `name line file`.
- Paths are normalized relative to the repo root.
