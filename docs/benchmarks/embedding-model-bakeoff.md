# Embedding Model Bakeoff

`tools/bench/embeddings/model-bakeoff.js` compares embedding models on:

- index/build cost
- retrieval quality (Recall@k, MRR, nDCG via `tools/eval/run.js`)
- retrieval latency/ranking drift (via `tools/reports/compare-models.js`)

## Usage

```bash
node tools/bench/embeddings/model-bakeoff.js
```

Default invocation runs a quick sampled/resumable bakeoff profile.

For a full-fidelity run, opt in with `--full-run` (and override as needed):

```bash
node tools/bench/embeddings/model-bakeoff.js \
  --repo . \
  --full-run \
  --models Xenova/bge-small-en-v1.5,Xenova/bge-base-en-v1.5,Xenova/e5-small-v2,Xenova/e5-base-v2,jinaai/jina-embeddings-v2-base-code \
  --baseline Xenova/bge-base-en-v1.5 \
  --dataset path/to/eval.json \
  --backend sqlite \
  --mode both \
  --top 10 \
  --out .testLogs/embedding-bakeoff.json
```

NPM alias:

```bash
npm run bench-embedding-models
```

Default behavior is tuned for smoke runs:

- default model set is `Xenova/bge-small-en-v1.5,Xenova/bge-base-en-v1.5`
- default baseline is `Xenova/bge-base-en-v1.5`
- `--incremental` defaults to `true`
- `--skip-compare` defaults to `true`
- `--json` defaults to `true`
- eval dataset defaults to `tests/fixtures/eval/triplecleat-bakeoff.json` when `--dataset` is omitted
- `--limit` defaults to `20` (applies to eval dataset and compare query set)
- `--heap-mb` defaults to `8192` for child build processes
- `--embedding-sample-files` defaults to `50` per mode (deterministic sampling; unsampled chunks use zero-vector fallback)
- `--embedding-sample-seed` defaults to `quick-smoke`
- `--resume` defaults to `true` and reuses completed model entries from the checkpoint file
- `--full-run` switches defaults to full mode (`--limit 0`, `--embedding-sample-files 0`, compare enabled, resume disabled) while still honoring explicit flags
- if sparse artifacts already exist for a model cache, build runs jump to `--stage 3` (embeddings) instead of full stage1/2 rebuild
- sqlite stage runs are isolated per mode (`code`, `prose`, `extracted-prose`, `records`) to reduce long-run stage4 instability risk

## Output

The report includes:

- per-model build timings (`buildIndexMs`, `buildSqliteMs`, `totalBuildMs`)
- per-model cache footprint (`bytes`, `gib`)
- per-model eval summary (`recallAtK`, `mrr`, `ndcgAtK`)
- compare-model latency summary (`elapsedMsAvg`, `wallMsAvg`)
- model-aware input formatting policy used (`inputFormatting`)
- progress status/checkpoint metadata (`progress.status`, `progress.completedModels`, `progress.resumedModels`)

Checkpoint file:

- defaults to `.testLogs/embedding-bakeoff.latest.json`
- override with `--checkpoint <path>`

## Model-aware formatting policy

Formatting is applied automatically in embedding call paths:

- `E5` family:
  - query embeddings use `query: <text>`
  - passage/chunk embeddings use `passage: <text>`
- `BGE` family:
  - query embeddings use `Represent this sentence for searching relevant passages: <text>`
  - passage/chunk embeddings are left unprefixed
- other families:
  - no automatic prefixing

These rules are implemented in `src/shared/embedding-input-format.js` and are folded into embedding identity so cache/index signatures remain deterministic after policy changes.

## Notes

- `build_index.js` full builds already include sqlite artifacts; use `--build-sqlite` only for explicit stage-4-only rebuilds.
- If `cache.root` is set in repo config, multi-model comparisons require `--build` so each model run refreshes artifacts deterministically.
- Use `--full-run` for full-fidelity defaults, then override individual knobs as needed.
- For full-fidelity embeddings (no sampling), pass `--embedding-sample-files 0`.
