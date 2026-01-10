# Retrieval Evaluation

`tools/eval/run.js` runs a query set against a repo and emits JSON metrics (Recall@k, MRR, nDCG@k).

## Usage

```bash
pairofcleats report eval --repo /path/to/repo --dataset /path/to/queries.json --backend sqlite --top 10
```

Options:
- `--repo`: repo root (defaults to current working directory)
- `--dataset`: JSON file with queries (defaults to `tests/fixtures/sample/eval.json`)
- `--backend`: `auto|memory|sqlite|sqlite-fts`
- `--top` (`-n`): top N results to evaluate (default: 10)
- `--ann` / `--no-ann`: include dense ANN in the run
- `--out`: write JSON report to a file
- `--pretty`: pretty-print JSON to stdout

## Dataset format

Each entry uses a query plus expected hits. `relevant` is the silver label set; `gold` is an optional stricter subset.

```json
[
  {
    "query": "greet",
    "mode": "code",
    "relevant": [{ "file": "src/index.js", "name": "greet" }],
    "gold": [{ "file": "src/index.js", "name": "greet" }]
  }
]
```

Compatibility:
- `expect` (used by fixture eval) is treated as `relevant` if present.

Sample dataset:
- `tools/eval/sample.json` includes a small silver+gold set using the sample fixture.

## Metrics

- Recall@k: relevant hits found in the top k results.
- MRR: mean reciprocal rank of the first relevant hit.
- nDCG@k: rank-aware gain normalized by the ideal ordering.
