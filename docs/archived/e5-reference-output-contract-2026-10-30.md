# Instruct-E5 reference output correction — 2026-10-30

The first real instruct-E5 raw-document qualification at `a18d2fb34` exits1
in13.659s. The independent reference assumes `last_hidden_state`; the pinned
export returns a different named tensor. Original model/weights are unchanged:
graph686,499B, SHA256
`e3aeea5355352d826bd952a9a96fab206c6c72d1a429c8773c9da5ac16e44af5`.

Decoded graph metadata declares `token_embeddings` as float32
`[batch_size,sequence_length,1024]` and `sentence_embedding` as pooled output.
The token output is the final encoder LayerNorm result; the later sentence
output applies mask mean and L2 normalization. Transformers4.3.2's encoder
preserves the output dictionary; its production feature-extraction pipeline
already accepts `token_embeddings`.

Only the finite instruct-E5 reference recipe changes its raw output name.
M3 retains `last_hidden_state`. The reference requires the exact own named
per-token tensor, preserves strict float32/rank/shape/mask admission and
independently computes masked mean/L2 under the unchanged1e-5 tolerance.
There is no arbitrary first-output, pooled-output or alias fallback. Receipts
report the actual name; original resource scopes retain both output tensors.

The discriminating control supplies the real two-output layout with a
contradictory pooled result first. Exact token arithmetic must win. Wrong key,
pooled-only and rank2 negatives reject while original tensor/model/tokenizer
cleanup remains asserted. The focused control passes148ms, with zero retries,
failures, timeouts or skips. Syntax/ESLint also pass.

Actual E5 inference after this correction is **pending**, deferred at the
user-requested checkpoint. The failed original receipt remains under historical
author-workspace `.tmp/tasks/q-1030/models130/e5-quality/`; the focused control
log is `.testLogs/run-1793368461316-ykr7zu/`. These files are not promised in
clean checkouts. Earlier direct MiniLM reference/single/batch/query and M3
judged-corpus observations pass at their recorded source; they do not establish
this E5 rerun or a new final-head full-suite result.
