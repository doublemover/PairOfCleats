# MiniLM component admission repair — 2026-10-30

Status: source implementation and static checks complete; new runtime tests and
actual-model qualification remain unrun. Inspection started from `ce65ac232` on
`codex/pr557-audit-repairs-20261012`, using Windows Node 26.13.0. This receipt does
not close [#1541](https://github.com/doublemover/PairOfCleats/issues/1541),
[#1542](https://github.com/doublemover/PairOfCleats/issues/1542) or
[#1544](https://github.com/doublemover/PairOfCleats/issues/1544).

## Demonstrated cause

Historical author-workspace evidence
`.testLogs/consumer-wave-next-20261030/minilm-single-callable-repaired.log` records
`TypeError: this.tokenizer is not a function` in the installed Transformers.js
4.3.2 feature-extraction pipeline. These task-local files are provenance, not
promised clean-checkout assets or final-candidate acceptance.

The executed `node_modules/@huggingface/transformers/dist/transformers.node.mjs`
calls `get_pipeline_files` with only `device` and `dtype` at line 34768. Equivalent
source is `src/pipelines.js:137`. The registry's `get_files` drops cache/local-only
selection again, calling `get_tokenizer_files(modelId)` without those options.
The tokenizer check looks for `tokenizer_config.json` in the default cache/local
model root; `get_file_metadata` declines the remote check when remote models are
disabled. The factory then tests the returned file list (`dist:34801`), omits
`AutoTokenizer.from_pretrained` (`dist:34819`), and the pipeline constructor
defaults the tokenizer to null (`dist:33161`). Its model load still receives the
requested custom cache policy. Thus a successful model load does not establish
that its tokenizer was admitted.

The actual capsule disables remote models at
`tests/embeddings/actual-export-qualification.js:100` and requests repository ID
`Xenova/all-MiniLM-L6-v2` with local-only loading and this absolute custom cache:
`C:/Users/sneak/Development/PairOfCleats/.tmp/tasks/p2-p3-closeout-20261029/actual-models`.
Read-only filesystem inspection found the 366-byte tokenizer configuration in
that cache, while the default package `.cache/Xenova/all-MiniLM-L6-v2` contains
only the 650-byte `config.json`. Both the default package cache and
`models/Xenova/all-MiniLM-L6-v2` lack `tokenizer_config.json`. This explains why
discovery passes config loading yet returns no tokenizer; the conclusion is
supported by the exact installed code and paths, not solely the error stack.

SHA-256 observations, all relative to the repository root:

| Observed path | SHA-256 |
| --- | --- |
| `node_modules/@huggingface/transformers/dist/transformers.node.mjs` | `5a51cd1fb0e85648610fcd63f1441a1a6c3755003da5b19706e6a0f0856bc67c` |
| `node_modules/@huggingface/transformers/src/pipelines.js` | `79914461be74f6468328e7cf50a171484b3805f9b186dc2b39a2fb32867bbb31` |
| `node_modules/@huggingface/transformers/src/utils/model_registry/get_files.js` | `ae3cac79c24e5b52bfa48d89e08a2dec7e11c36f921c526a9a182b002ca5012b` |
| `node_modules/@huggingface/transformers/src/utils/model_registry/get_tokenizer_files.js` | `020b5a80717b90871e5d4b6caf807fe31e147bc966abc41823e7125f8714fcaa` |
| `node_modules/@huggingface/transformers/src/utils/model_registry/get_file_metadata.js` | `c6ac6e2e1927d3288f4b4d7c0a8b4a3fb0500a78b926078b653fa0ebdb6f5667` |
| `.tmp/tasks/p2-p3-closeout-20261029/actual-models/Xenova/all-MiniLM-L6-v2/tokenizer_config.json` | `9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3` |
| `.tmp/tasks/p2-p3-closeout-20261029/actual-models/Xenova/all-MiniLM-L6-v2/tokenizer.json` | `da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0` |
| `node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2/config.json` | `7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7` |

## Source change and authored controls

`src/shared/embedding-model-loading.js` directly loads the required tokenizer and
AutoModel, then constructs the upstream `FeatureExtractionPipeline`. The task
registry identifies this exact pipeline/model pair for feature extraction.
Requested model ID, custom cache root, q8 dtype, local-only policy and captured
session options remain the selection. No runtime globals, dependency patches,
download policy, artifact/cache identity or model-profile semantics change.

Versioned modules and partially supplied component APIs require the complete
component surface. Only unversioned, wholly factory-only injected modules retain
the existing factory seam. Component acquisition failures never enter a factory
fallback. Original component disposers are captured by the shared resource
scope; startup/constructor failure closes admitted components, pending ownership
is retained, and pipeline disposal joins/retries that same scope without loading
replacement components. The EG2 profile path retains its existing exact checks.

`tests/embeddings/feature-extraction-component-admission.test.js` uses the actual
installed FeatureExtractionPipeline/Tensor with inert components to cover
callability, original receiver, mask-mean/L2 output, exact selection/options,
session snapshotting, missing/partial APIs, startup and constructor failures,
captured disposer retry, prefetch cancellation and unchanged global environment.
`tests/indexing/embeddings/embeddinggemma2-contract.test.js` now supplies the
component constructor for its generic control. The existing callable and cache
lease fixtures remain intact.

Static results: `node --check` passed for the changed loader and both fixtures;
focused ESLint and `git diff --check` passed. Runtime tests, fresh MiniLM routes,
full front gate, model-quality metrics and before/after performance acceptance
are explicitly unrun by this worker. No model was downloaded and no Git mutation
was performed. M3/E5/EG2 numerical or judged-quality claims cannot be inferred
from this MiniLM component repair.

## Qualification harness follow-up

The complete live issue bodies and all follow-ups for #1541/#1542/#1544 were
read through the GitHub connector on 2026-10-30. M3/E5 still require independent
exact-export numerical references and judged retrieval measurements; #1544
retains actual supported routes plus allocation/copy and resource measurements.
Existing synthetic controls remain useful within their recorded scope.

Source inspection demonstrated a separate cancellation loss in the native
qualification harness: its phase wrapper checked cancellation after acquisition
completed but before the caller received the resource. A late abort could thus
prevent assignment of the raw-reference/model lifetime and omit its cleanup from
the harness finally block. `tests/embeddings/helpers/qualification-phase.js`
now transfers the completed resource to its caller before that check. Both raw
reference and artifact acquisitions use the hook. The inert
`tests/embeddings/qualification-phase-resource-adoption.test.js` covers a late
successful acquisition, failed construction and cancellation before admission.

`tests/embeddings/actual-export-qualification.js` also records the actual executed
Transformers Node bundle hash, distinguishes independent numerical reference
from generic provider self-consistency and unmeasured judged quality, and labels
large-batch samples warm with explicit rows/second. Adding the executed bundle
to the reference binding intentionally requires a new upstream-reference receipt;
the older receipt lacks that source owner and cannot authorize the revised
capsule. No before/after speedup or tensor-lifetime inference is added.

These harness changes pass syntax and focused ESLint checks; the new inert
regression and every revised actual-model capsule remain unrun by this worker.
The owned path manifest is the loader, the component-admission regression, the
EG2 contract fixture, this archive, the actual-export qualification harness, the
qualification-phase helper and its resource-adoption regression. No active
roadmap, status matrix, parent receipt, Git commit or remote was modified.
