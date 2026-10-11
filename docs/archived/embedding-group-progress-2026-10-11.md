# Embedding admission, grouping and remaining-work estimate

Baseline: campaign `91b3c48968d3453d051bd41e23a70d98eca4f697` (the affected runner and pipeline equal the running `d54ddbfca` versions). Local implementation; no changes to a running index.

## Defect and ownership

The scheduler's canonical `normalizeSchedulerMaxPending` returns null for unset, zero or unlimited pending limits. The embedding runner coerced null through Number(null) and then Math.max(1, ...), inventing a one-write limit. The same coercion made the adaptive ceiling one. Existing writer tests injected literal limits and missed this scheduler/consumer boundary.

The extracted embedding writer admission owner uses the canonical scheduler normalizer for both initial and live limits. Existing token-derived default, memory-pressure thresholds, floor/ceiling and adjustment cadence remain. Explicit finite limits still bind. Missing memory samples do not become zero-pressure samples. Metrics report the actual reason for the current writer limit. No provider concurrency is increased.

## Work representation and grouping

Existing file groups, ordered chunk indices, code/doc mappings, hash reuse, exact-text deduplication and cross-file in-flight coalescing remain the owners. Each unique compute text carries its source file, chunk identity and code/doc role into the bounded global request window. A duplicate uses its first representative for computation; all existing consumers still receive the vector through their original mapping.

Within the admitted window, deterministic power-of-two token-length buckets preserve file locality as a secondary key. Batches retain the existing item limit and summed-token budget, including the existing single oversized-item policy. There is no new padding-budget reinterpretation or unconditional batch boundary per bucket. Results scatter by original input index before request and file/chunk reassembly. Inputs are never concatenated, truncated or replaced with a neighbor's vector. Graph proximity alone does not justify vector reuse.

This uses O(window-text-count) additional references/indices and O(file-count) progress scalars. It does not copy source text or expand dependency graphs. Existing request-count and retained-text-byte admission remains in force; this is not a hard whole-process RSS limit. The existing global flush still owns one model call at a time. Metrics now distinguish that active call, queued requests/texts/tokens, live coalescer entries, scheduler running/waiting work and writer peak/bytes.

## Estimate

Remaining work initially uses known source spans and documentation lengths for each file. File cache/hash preparation replaces that estimate with remaining payload sizes. Existing formatted-token estimates and exact-text/cache/coalescing results further adjust it to unique owned work. Completed batches debit their owning groups; successful file completion removes any residue, including wholly cached/skipped groups.

The compute estimate uses the latest two minutes, capped at 64 completed batch samples. It applies observed cost per estimated token to the known remaining token estimate. Wall-time span counts overlapping calls once and includes producer gaps between sampled batches. With no samples it reports unknown; during a long call it retains the last observation. This is an estimate, not a tokenizer oracle or a guarantee of model runtime: padding/sequence-length nonlinearity, future cache hits, changed provider behavior and truncation can change actual cost. Padded-token telemetry makes that mismatch visible. The UI labels it `compute eta`; final writer/backend publication time is not silently included in this estimate.

`texts_scheduled` now increments when a logical embedding request enters processing, before completion and including cache reuse. Previously it remained zero forever, breaking text progress and its ETA denominator.

## Bounded validation

- Real scheduler -> embedding admission -> writer tests cover null/unset/zero and finite limits, live cap changes, running versus waiting counts, byte backpressure, oversized rejection and drain.
- Fake-provider pipeline tests cover source/code/doc scatter, scheduled/completed accounting, failure stopping later batches and reservation release.
- Synthetic 32-text alternating-length case: baseline and grouped execution both make four calls. Estimated padded tokens fall from 8192 to 4160; this is a deterministic packing measurement, not a measured production inference speedup.
- Remaining-size fixture distinguishes a 40-character completed file from a 4000-character remaining file, refines known work, replaces obsolete throughput samples and reaches zero only after accounted work completes.
- Existing pipeline, batching policy, writer queue and small stub stage-three observability fixtures are exercised. No full source index, paid inference or user-machine experiment is required for these regressions.
