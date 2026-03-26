# Shared Module Review: #410

Issue: `#410`  
Scope: root-level `src/shared` files and root contracts assigned to `#410` in the shared-module ledger.

## Overall Assessment

The root shared surface is mostly healthy, but it contains four weak clusters that should drive follow-up cleanup:

1. `env/runtime/policy`
2. `numeric/path/order primitives`
3. `observability/metrics/ops`
4. specialized root contracts

The highest-priority follow-ups are:

- split [`src/shared/env.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/env.js)
- split [`src/shared/runtime-envelope.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope.js)
- split [`src/shared/auto-policy.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/auto-policy.js)
- split [`src/shared/metrics.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/metrics.js)
- merge the numeric normalization overlap between [`src/shared/limits.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/limits.js) and [`src/shared/number-coerce.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/number-coerce.js)
- move [`src/shared/editor-config-contract.json`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/editor-config-contract.json) out of the generic root shared bucket

## Cluster Notes

### Env / Runtime / Policy

- [`src/shared/env.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/env.js) is doing too much. It mixes runtime, bench, TUI, testing, document-extractor stub, and scheduler/test-only environment parsing.
- [`src/shared/runtime-envelope.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope.js) has a useful public facade, but it currently bundles env patching, argument parsing, and runtime policy resolution.
- [`src/shared/auto-policy.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/auto-policy.js) mixes repository scanning, memoization, ignore handling, and auto-policy derivation.
- [`src/shared/env-path.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/env-path.js) and [`src/shared/toolchain-env.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/toolchain-env.js) are coherent, but their boundaries should be documented so they do not get reabsorbed into broader env helpers.

### Numeric / Path / Ordering

- [`src/shared/limits.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/limits.js) and [`src/shared/number-coerce.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/number-coerce.js) overlap too much.
- [`src/shared/path-normalize.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/path-normalize.js) is a good canonical path layer and should stay that way.
- [`src/shared/order.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/order.js) and [`src/shared/sort.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/sort.js) are a reasonable pair as long as `sort.js` remains the tiny primitive comparator.

### Observability / Metrics / Ops

- [`src/shared/metrics.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/metrics.js) has become the biggest root shared file and should be broken up by metric family behind one shared registry.
- [`src/shared/observability.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/observability.js) has a clear purpose and should remain separate from metrics.
- [`src/shared/ops-failure-injection.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/ops-failure-injection.js), [`src/shared/ops-health.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/ops-health.js), and [`src/shared/ops-resource-visibility.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/ops-resource-visibility.js) read like an undeclared family and should move under a dedicated ops path.

### Specialized Contracts

- [`src/shared/editor-config-contract.json`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/editor-config-contract.json) is an editor integration contract, not a generic shared primitive.
- [`src/shared/native-accel.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/native-accel.js) is fine as a stable feasibility contract, but it should stay clearly documented as specialized.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/auto-policy.js` | `split`, `document`, `test` | Split repo scanning and memoization from policy derivation and huge-repo presets. |
| `src/shared/config.js` | `keep`, `document` | Keep this as the tiny plain-object and config-merge primitive surface. |
| `src/shared/disk-space.js` | `keep`, `document`, `test` | Coherent capacity-check helper; avoid duplicate byte-formatting and size-estimation logic elsewhere. |
| `src/shared/editor-config-contract.json` | `move`, `document`, `test` | Move to contracts or editor integration ownership. |
| `src/shared/env-path.js` | `keep`, `document`, `test` | Keep as the PATH normalization surface; document the boundary against path-normalize. |
| `src/shared/env.js` | `split`, `document`, `test` | Break into runtime, testing, bench, and feature-specific env parsing surfaces. |
| `src/shared/error-codes.js` | `split`, `document`, `test` | Separate canonical error registry from hint heuristics. |
| `src/shared/identity.js` | `keep`, `document`, `test` | Good identity-envelope module; keep chunk and symbol boundaries explicit. |
| `src/shared/invariants.js` | `keep`, `document` | Keep small; split deterministic hashing later only if the family grows. |
| `src/shared/iterables.js` | `keep`, `document` | Good low-level iterable normalization surface. |
| `src/shared/jsonrpc.js` | `keep`, `document`, `test` | Coherent framing/parser module; keep protocol semantics outside it. |
| `src/shared/limits.js` | `merge`, `document`, `test` | Merge or re-export through number-coerce to remove duplicate numeric entry points. |
| `src/shared/lines.js` | `keep`, `document` | Good narrow line-index helper. |
| `src/shared/logging/warn-once.js` | `keep`, `document` | Good shared duplicate-warning suppressor. |
| `src/shared/merge.js` | `split`, `document`, `test` | Separate merge mechanics from JSONL run-file concerns. |
| `src/shared/metrics.js` | `split`, `document`, `test` | Break into metric families behind one registry facade. |
| `src/shared/native-accel.js` | `keep`, `document` | Keep as a specialized no-go feasibility contract. |
| `src/shared/number-coerce.js` | `keep`, `merge`, `document`, `test` | Make this the canonical numeric coercion surface. |
| `src/shared/observability.js` | `keep`, `document`, `test` | Clear correlation and context propagation boundary; keep separate from metrics. |
| `src/shared/ops-failure-injection.js` | `move`, `document`, `test` | Move under a declared ops/testing family. |
| `src/shared/ops-health.js` | `move`, `document`, `test` | Move under the same ops family as related operational checks. |
| `src/shared/ops-resource-visibility.js` | `move`, `document`, `test` | Move under the same ops family as resource diagnostics. |
| `src/shared/optional-deps.js` | `keep`, `document`, `test` | Good optional dependency probe surface. |
| `src/shared/order.js` | `keep`, `document` | Good higher-level ordering surface above sort.js. |
| `src/shared/path-normalize.js` | `keep`, `document`, `test` | Keep as the canonical path normalization layer. |
| `src/shared/reuse-diagnostics.js` | `keep`, `document`, `test` | Coherent reuse observation and summary surface. |
| `src/shared/runtime-envelope.js` | `split`, `document`, `test` | Keep one facade, but split env patching, parsing, and runtime resolution internals. |
| `src/shared/sort.js` | `keep`, `document` | Intentionally tiny primitive comparator; keep it that way. |
| `src/shared/time-format.js` | `keep`, `document` | Good tiny duration-format helper. |
| `src/shared/toolchain-env.js` | `keep`, `document`, `test` | Good narrow toolchain env patch helper. |

