# Finite-string type IR: engineering experiment log

Date: 2026-10-11 UTC. Scope: bounded cloud experiments and a finite-string kernel,
with links to preceding checkpoint and compiler-root regressions. This is an
engineering record of observable tests and design decisions, not a universal
TypeScript implementation or a NuSSR acceptance report.

## Baseline and environment

- Checkout: `/workspace/shared/PairOfCleats-enrichment`.
- Branch: `fix/enrichment-resource-diagnosis`.
- Baseline HEAD: `679573bd885bb0047f5760db0608ff13a7590020`.
- The kernel, associated tests, and current receipts were uncommitted changes
  over that baseline when measured. Source hashes in the receipt identify the
  measured algorithm files; the baseline SHA alone does not identify those files.
- Runtime: Node `v26.11.1`, V8 `14.6.202.34-node.37`, Linux x64. The receipt is the
  authoritative runtime record if this prose and a later rerun differ.
- Node executable: `/workspace/shared/node-v26.11.1-linux-x64/bin/node`.
- Physical, independently prepared `node_modules`; bootstrap readiness inspection
  reported `ready: true`, with native activation and setup-input verification.
- The runner reported that `lscpu` could not read the container CPU topology.
  No machine-wide CPU count or hardware-normalized performance claim is made.
- No user-machine index was started, stopped, or inspected by these experiments.

## Preceding defects: evidence and boundaries

### Checkpoint lifecycle ownership

Commit `e44b62aa83e0f1de123ed910d25cb015a2576f54` changes the
[patch queue](../../src/index/build/build-state/patch-queue.js) and adds the
[overlapping-flush regression](../../tests/indexing/state/patch-queue-overlapping-flush-lifecycle.test.js).

The fixture creates overlapping detached writes A and B. A completes while B is
still applying. C is the final checkpoint; retiring ownership by key rather than
by the live owner can discard C and cancel the lifecycle containing its debounce
and waiter timer. A later heartbeat may still succeed. The regression uses the
actual checkpoint tracker with 8,118 initial ticks and 50 final ticks, and requires
the writes to be observed as A, 8,118, 8,168, then a later heartbeat. Additional
cases retain an 80 ms best-effort timeout, a required waiter, retry data after an
apply rejection, and idle owner cleanup.

The fix counts detached active flushes and retires only the expected idle owner.
This is a reproducible source defect consistent with the supplied symptom shape;
it does not establish the exact blocked operation of the manually terminated
NuSSR process. Completed parse counters and absent watchdog messages alone do not
identify its phase. The present kernel test batch does not claim a fresh full-run
requalification of that earlier commit.

### TypeScript source-root identity

Commit `eafc72963372df3e9574dbbdd33b329e30327345` introduces the shared
[root canonicalization owner](../../src/index/tooling/typescript/roots.js).
The [alias regression](../../tests/tooling/typescript-root-aliases.test.js) asserts
that a small duplicate physical-plus-virtual Program has seven SourceFiles and
its canonical form has four; the canonical form removes a duplicate-declaration
diagnostic while preserving expected symbols and types. It also checks ambient
context, referenced projects, and module augmentation. The
[preflight regression](../../tests/tooling/typescript-root-preflight.test.js)
checks sealed closure identities, project references, a conditional export, and
provider phase evidence.

This removes redundant roots without treating embedded segments as whole-file
aliases or discarding referenced compiler context. It does not prove that root
deduplication resolves arbitrary type-instantiation expansion or the older V8
out-of-memory run. The kernel experiments below address a separate representation
path.

## Questions tested and decisions

1. Can thousands of independent template positions be represented without
   distributing their Cartesian product? Use immutable, hash-consed Literal,
   Union, and Concat nodes. The product language remains symbolic.
2. Can concatenation be associative without destroying sharing? Fully flattening
   nested Concat operands was rejected: repeated doubling would demand an
   exponential operand list. The implementation uses a canonical persistent
   binary factor sequence, split at the largest power of two strictly below its
   factor count. It preserves repeated operands and aligned doubling.
3. Can overlapping unions and ambiguous concatenation be queried exactly?
   Membership memoizes all reachable end offsets for each `(node, start)` pair.
   Classification retains at most two distinct actual string witnesses. It does
   not add union cardinalities or multiply concat cardinalities.
4. Can persisted identity be checked? Import validates schema, canonical root,
   node and child ordering, all referenced nodes, reachability, acyclicity, and
   recomputed content identities. Multiple explicit roots preserve target nodes
   that a synthetic union wrapper could flatten away.
5. Can resource exhaustion be distinguished from a negative or completed answer?
   Work, allocation, state, input, arena, deadline, and witness-output boundaries
   either admit the exact operation or throw an explicit typed incomplete error.
   Abort retains the repository's `ABORT_ERR` semantics.
6. Should a worst-case memory estimate also be the serialization CPU charge?
   An initial receipt exposed avoidable rejection. The revised serializer keeps
   conservative allocation admission but scans exact JSON escaping to admit
   actual emitted UTF-16 units as serialization work. Limits were not increased.

## Supported semantics and API

The [kernel exports](../../src/index/tooling/typescript/type-ir/index.js) are
`createTypeIrArena`, `classifyTypeIr`, `containsTypeIr`, `serializeTypeIr`,
`serializeTypeIrRoots`, `deserializeTypeIr`, and `TYPE_IR_DEFAULT_BUDGET`.

- Union is associative, commutative and idempotent over canonical operands.
  Empty union denotes the empty language. Concatenation is associative, retains
  repeated factors, eliminates epsilon, and is annihilated by the empty language.
- Concatenation identity normalizes a factor sequence, not language equivalence:
  a literal `ab` and concatenated literals `a`, `b` may have different node IDs.
- Contexts are explicit in every node identity. Foreign or fabricated arena
  handles are rejected. Interning compares the full canonical payload on digest
  hits; durable SHA-256 addressing still assumes cryptographic collision
  resistance rather than mathematical injectivity.
- For nonempty concatenation, varying one factor while fixing its surroundings
  yields a distinct word by left/right cancellation. This supports exact
  zero/one/many classification, even with ambiguous segmentation. Overlapping
  union witnesses are compared as strings, not merely as node IDs.
- `classifyTypeIr` computes a cardinality class together with concrete witnesses.
  It can fail for an enormous concrete singleton output. It does not claim an
  independently completed compressed-word cardinality answer in that case.
- `maxWitnessBytes` is an optional nonnegative UTF-8 output allowance. It is
  admitted before concat witness materialization and includes selected witness
  pair totals. Joining split surrogate halves uses the correct four-byte scalar
  size rather than the six-byte sum of two lone halves. Zero permits an empty
  language or an epsilon witness. JSON response framing is a caller-side charge.
- Arena storage charges and per-operation cumulative allocation charges are
  logical resource accounting, not measured live V8 allocation or hard RSS caps.
  The deadline is cooperative. Native hash/JSON/string operations have bounded
  admission and post-checks, but are not preemptible halfway through execution.
- The schema has sorted distinct `rootIds`, sorted node records, context identity,
  and a flat shared graph. Import never trusts serialized BigInt weight metadata.

## Reproduction

Run in a prepared checkout, preserving any unrelated work:

```sh
export PATH=/workspace/shared/node-v26.11.1-linux-x64/bin:$PATH
node --version
node --input-type=module -e "import {inspectBootstrapReadiness} from './src/shared/bootstrap-readiness.js'; console.log(await inspectBootstrapReadiness());"
node tests/run.js --lane all --match typescript-type-ir- --jobs 1 --timeout-ms 30000 --retries 0
node tests/tooling/fixtures/typescript-type-ir-scaling.js > /tmp/type-ir-scaling.json
```

The scaling harness supports only the fixed workloads recorded here. Each case
runs in a fresh Node process with a 20-second cooperative operation deadline and
an enforced 29-second parent timeout. Every failure and its counters are retained;
independent query phases still run after an unrelated phase fails. No retry,
timeout extension, forced GC, or unfiltered test suite is used.

### Fixture definitions and observed checks

- [Exact algebra and query fixture](../../tests/tooling/typescript-type-ir-exact.test.js):
  empty/epsilon laws, union normalization, concat association across powers of two
  and neighboring widths, repeated operands, same word with different literal
  segmentation, overlapping/variable-width languages, split surrogates, and a
  small deterministic independently enumerated oracle. Enumeration exists only
  in this bounded test oracle, not the production algorithms.
- [Compact representation fixture](../../tests/tooling/typescript-type-ir-compact.test.js):
  4,096 repeated binary positions in at most 16 nodes, 1,024 distinct binary
  positions, membership and witnesses, a 12,000-deep doubling construction in
  exactly 12,001 nodes, and a 2,048-deep shared serialization round-trip. The deep
  doubling membership input is the empty string, not an exponentially long word.
- [Boundary fixture](../../tests/tooling/typescript-type-ir-boundaries.test.js):
  multi-root round-trip and deterministic identity, forged/cyclic/missing or
  noncanonical graphs, context mixing, forced digest collision, construction and
  query budget exhaustion, deadline and in-traversal abort, UTF-8 witness caps,
  and all 65,536 UTF-16 code units for JSON escape-length admission.

The three kernel fixtures passed together in 887 ms after witness admission was
added (117/538/226 ms individual durations). The subsequent zero-byte witness
boundary correction passed its affected fixture in 113 ms. Scoped ESLint, the coordinated `npm run format`, and
`git diff --check` passed. After formatting, all five measured algorithm source
hashes still matched the current receipt. These checks do not constitute a
completed repository-wide gate. Author-workspace `.testLogs` are historical local receipts,
not files promised to exist in a clean checkout.

## Preserved failed experiment

The [conservative accounting receipt](typescript-type-ir-scaling-conservative-2026-10-11.json)
contains seven successful cases and one explicit failure. At distinct width 4,096,
construction retained 16,383 nodes, while serialization rejected a request for
6,065,193 work credits after 65,533 credits had been used, against the unchanged
5,000,000-credit limit. Independent membership and classification still completed.

The request was derived from a worst-case escaped allocation bound. Actual output
is 2,991,882 UTF-8 bytes for this ASCII case. The revised algorithm scans exact
JSON string lengths, including controls and lone surrogates, and pre-admits exact
emission work plus scan/traversal/sort charges. Conservative allocation admission
is unchanged. An emitted-length invariant and the exhaustive code-unit fixture
check the length calculation. The old failure is retained, not recast as success.

## Current measured cases

Authoritative [current JSON receipt](typescript-type-ir-scaling-2026-10-11.json),
generated **2026-10-11T09:30:56.337Z**, includes source hashes and per-phase process snapshots.
All eight cases completed with the same default logical budgets. These are single
samples from fresh processes, not statistically qualified benchmark estimates.

For each width `k`, `2^k` is the mathematical denotation of independent binary
positions. The kernel did not enumerate those strings or compute their full exact
cardinality. Each constructor receives its flat factor input once; this does not
claim arbitrary incremental construction has linear cumulative cost.

| Mode | Width | Nodes | Serialized bytes | Membership input UTF-16 units | Construct ms | Serialize ms | Membership ms | Classify ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| repeated | 64 | 9 | 2,155 | 64 | 2.126 | 0.866 | 1.499 | 0.512 |
| repeated | 256 | 11 | 2,660 | 256 | 2.978 | 1.027 | 7.025 | 0.552 |
| repeated | 1024 | 13 | 3,165 | 1,024 | 4.719 | 0.584 | 10.652 | 0.612 |
| repeated | 4096 | 15 | 3,669 | 4,096 | 14.357 | 0.716 | 27.351 | 0.677 |
| distinct | 64 | 255 | 46,432 | 310 | 6.033 | 2.376 | 1.224 | 1.335 |
| distinct | 256 | 1023 | 186,329 | 1,426 | 13.248 | 5.483 | 2.941 | 3.415 |
| distinct | 1024 | 4095 | 746,250 | 6,058 | 36.075 | 14.136 | 7.447 | 10.299 |
| distinct | 4096 | 16383 | 2,991,882 | 27,562 | 117.226 | 45.706 | 24.168 | 41.326 |

The following are **before/after process snapshots**, not peaks or a hard memory
bound. They include runtime state, native bootstrap probes, GC timing, and all
phases in that case. MiB means 1,048,576 bytes.

| Mode | Width | Arena logical charged bytes | Heap used MiB before → after | RSS MiB before → after |
|---|---:|---:|---:|---:|
| repeated | 64 | 14,377 | 11.10 → 11.84 | 68.83 → 70.21 |
| repeated | 256 | 17,826 | 11.03 → 9.43 | 68.77 → 71.30 |
| repeated | 1024 | 21,324 | 11.09 → 10.38 | 68.74 → 75.37 |
| repeated | 4096 | 24,688 | 11.07 → 13.69 | 68.78 → 78.96 |
| distinct | 64 | 384,283 | 11.10 → 9.96 | 68.63 → 71.77 |
| distinct | 256 | 1,559,074 | 11.06 → 12.09 | 68.82 → 75.49 |
| distinct | 1024 | 6,299,838 | 11.01 → 17.41 | 68.30 → 84.66 |
| distinct | 4096 | 25,297,110 | 11.22 → 31.84 | 68.93 → 115.77 |

## Open questions and acceptance limits

- This kernel supports finite strings, not the full TypeScript type algebra.
  Recursive aliases, arbitrary conditionals/mapped types, inference, and all
  legacy printed-type parity require additional owners and proofs.
- A separate cardinality-only API could avoid unnecessary witness projection,
  but exact singleton unions require compressed-word equality across differing
  segmentations. Node-ID comparison is insufficient. That algorithm is not
  claimed or supplied here.
- Witness selection is deterministic but not minimum-length optimization. An
  intermediate chosen witness may exhaust a cap even if another selection would
  be smaller; the result is explicit incomplete, never a false negative.
- Aligned doubling has linear node count, but its stored BigInt factor weights
  total quadratic bits in depth. General persistent-sequence rebalancing and
  repeated incremental insertion have their own charged costs.
- Exact membership depends on both DAG size and explicit input length and can
  exhaust its state/work allowance on ambiguous cases. No constant-time query
  claim follows from compact representation.
- Whole-graph JSON serialization and parsing remain admitted materializations.
  Streaming a transport elsewhere does not remove this kernel's string cost.
- Current process snapshots do not certify a hard RSS bound, an arbitrary-host
  runtime bound, or freedom from every possible type/compiler explosion.
- NuSSR full-index completion, output equivalence, and end-to-end memory behavior
  have not been established by these cloud fixtures. No new claim is made about
  the exact phase of the earlier manually terminated retry or the cause of every
  historical out-of-memory event.

## Primary implementation links

- [Arena and identity](../../src/index/tooling/typescript/type-ir/arena.js)
- [Persistent factor sequence](../../src/index/tooling/typescript/type-ir/sequence.js)
- [Queries and witness admission](../../src/index/tooling/typescript/type-ir/queries.js)
- [Serialization and verification](../../src/index/tooling/typescript/type-ir/serialization.js)
- [Logical operation budgets](../../src/index/tooling/typescript/type-ir/budget.js)
- [Fixed scaling harness](../../tests/tooling/fixtures/typescript-type-ir-scaling.js)
