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
- keep [`src/shared/runtime-envelope/resolve.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope/resolve.js) and [`src/shared/runtime-envelope/env-patch.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope/env-patch.js) as the runtime-envelope owners
- keep the auto-policy split centered on [`src/shared/auto-policy/build.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/auto-policy/build.js), with the old root facade removed
- keep the metric-family split centered on [`src/shared/metrics/core.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/metrics/core.js)
- merge the numeric normalization overlap between [`src/shared/limits.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/limits.js) and [`src/shared/number-coerce.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/number-coerce.js)
- keep the new narrow helper surfaces such as [`src/shared/search-request.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/search-request.js), [`src/shared/repo-paths.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/repo-paths.js), and [`src/shared/json-file.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-file.js) from being reabsorbed into broad buckets

## Cluster Notes

### Env / Runtime / Policy

- [`src/shared/env.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/env.js) is doing too much. It mixes runtime, bench, TUI, testing, document-extractor stub, and scheduler/test-only environment parsing.
- The new leaf modules under [`src/shared/env/`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/env) are the right direction and should remain explicit instead of collapsing back into `env.js`.
- 2026-05-21 update: internal `bin`, `src`, `tools`, and `tests` callers now import the env leaves directly, and `src/shared/env.js` is retained as the public facade rather than the default internal import surface.
- The old `src/shared/runtime-envelope.js` facade has been removed; [`src/shared/runtime-envelope/resolve.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope/resolve.js), [`src/shared/runtime-envelope/resolve-current-process-envelope.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope/resolve-current-process-envelope.js), [`src/shared/runtime-envelope/env-patch.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope/env-patch.js), and [`src/shared/runtime-envelope/parse.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope/parse.js) now own runtime resolution, current-process derivation, env patching, and parsing directly.
- The split internals under [`src/shared/runtime-envelope/`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-envelope) should stay as the ownership boundary for parsing, env patching, and runtime resolution details.
- The old root-level `src/shared/auto-policy.js` facade has been removed; callers import [`src/shared/auto-policy/build.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/auto-policy/build.js) directly.
- The extracted helpers under [`src/shared/auto-policy/`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/auto-policy) are the ownership boundary for repo scanning and profile selection logic.
- [`src/shared/env-path.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/env-path.js) and [`src/shared/toolchain-env.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/toolchain-env.js) are coherent, but their boundaries should be documented so they do not get reabsorbed into broader env helpers.

### Numeric / Path / Ordering

- [`src/shared/limits.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/limits.js) and [`src/shared/number-coerce.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/number-coerce.js) overlap too much.
- [`src/shared/path-normalize.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/path-normalize.js) is a good canonical path layer and should stay that way.
- [`src/shared/order.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/order.js) and [`src/shared/sort.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/sort.js) are a reasonable pair as long as `sort.js` remains the tiny primitive comparator.

### Observability / Metrics / Ops

- [`src/shared/metrics/core.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/metrics/core.js) has become the biggest root shared file and should be broken up by metric family behind one shared registry.
- [`src/shared/observability.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/observability.js) has a clear purpose and should remain separate from metrics.
- [`src/shared/ops/failure-injection.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/ops/failure-injection.js), [`src/shared/ops/health.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/ops/health.js), and [`src/shared/ops/resource-visibility.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/ops/resource-visibility.js) read like an undeclared family and should move under a dedicated ops path.

### Narrow Promoted Leaves

- [`src/shared/search-request.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/search-request.js), [`src/shared/repo-cache-config.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/repo-cache-config.js), [`src/shared/repo-paths.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/repo-paths.js), and [`src/shared/json-file.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/json-file.js) are good examples of hard-cutover leaf modules that should stay explicit.
- [`src/shared/file-paths.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/file-paths.js), [`src/shared/file-read.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/file-read.js), and the `bundle-io-*` path/checksum/constants helpers should remain narrow rather than regrowing inside bigger buckets.
- [`src/shared/native-accel.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/native-accel.js) is fine as a stable feasibility contract, but it should stay clearly documented as specialized.

## Selected File Ledger

The JSON companion is the authoritative full per-file ledger. This markdown companion keeps the highest-signal entries and the currently important split seams.

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/auto-policy.js` | `removed`, `document`, `test` | Root facade removed after consumers moved to `src/shared/auto-policy/build.js`. |
| `src/shared/auto-policy/build.js` | `keep`, `document`, `test` | Keep repo-scan and profile-selection leaves narrow after the split. |
| `src/shared/auto-policy/profile.js` | `keep`, `document`, `test` | Keep repo-scan and profile-selection leaves narrow after the split. |
| `src/shared/auto-policy/repo-scan.js` | `keep`, `document`, `test` | Keep repo-scan and profile-selection leaves narrow after the split. |
| `src/shared/bundle-io-checksum.js` | `keep`, `document`, `test` | Keep bundle checksum logic in a small dedicated helper rather than folding it back into broader IO surfaces. |
| `src/shared/bundle-io-constants.js` | `keep`, `document`, `test` | Keep bundle-IO constants explicit and local to the family. |
| `src/shared/bundle-io-paths.js` | `keep`, `document`, `test` | Keep path composition separate from bundle read/write orchestration. |
| `src/shared/config.js` | `keep`, `document` | Keep this as the tiny plain-object and config-merge primitive surface. |
| `src/shared/context-pack-request.js` | `keep`, `document`, `test` | Keep context-pack request projection pure and leave transport validation, progress, error mapping, and workspace trust checks in the owning surfaces. |
| `src/shared/direct-execution.js` | `keep`, `document`, `test` | Good narrow direct-entrypoint helper that should not be folded back into CLI wrappers. |
| `src/shared/disk-space.js` | `keep`, `document`, `test` | Coherent capacity-check helper; avoid duplicate byte-formatting and size-estimation logic elsewhere. |
| `src/shared/env-path.js` | `keep`, `document`, `test` | Keep as the PATH normalization surface; document the boundary against path-normalize. |
| `src/shared/env.js` | `keep`, `document`, `test` | Public env facade only; internal callers import the runtime, testing, bench, TUI, or core leaves directly. |
| `src/shared/env/bench.js` | `keep`, `document`, `test` | Keep bench-only env parsing out of the generic root env surface. |
| `src/shared/env/core.js` | `keep`, `document`, `test` | Keep shared env parsing roots explicit instead of re-widening `env.js`. |
| `src/shared/env/runtime.js` | `keep`, `document`, `test` | Keep runtime-specific env ownership narrow. |
| `src/shared/env/testing.js` | `keep`, `document`, `test` | Keep testing env behavior isolated from production env parsing. |
| `src/shared/env/tui.js` | `keep`, `document`, `test` | Keep TUI env handling isolated from generic runtime parsing. |
| `src/shared/error-codes.js` | `split`, `document`, `test` | Separate canonical error registry from hint heuristics. |
| `src/shared/file-paths.js` | `keep`, `document`, `test` | Keep path predicates and file-path helpers separate from file reading and JSON helpers. |
| `src/shared/file-read.js` | `keep`, `document`, `test` | Keep bounded file and JSON read helpers separate from broader file/path buckets. |
| `src/shared/identity.js` | `keep`, `document`, `test` | Good identity-envelope module; keep chunk and symbol boundaries explicit. |
| `src/shared/index-state-utils.js` | `keep`, `document`, `test` | Runtime/shared index-state helper should stay out of `tools/shared` now that it has a real shared home. |
| `src/shared/invariants.js` | `keep`, `document` | Keep small; split deterministic hashing later only if the family grows. |
| `src/shared/iterables.js` | `keep`, `document` | Good low-level iterable normalization surface. |
| `src/shared/json-file.js` | `keep`, `document`, `test` | Keep structured JSON-file helpers as a dedicated small surface. |
| `src/shared/jsonrpc.js` | `keep`, `document`, `test` | Coherent framing/parser module; keep protocol semantics outside it. |
| `src/shared/limits.js` | `merge`, `document`, `test` | Merge or re-export through number-coerce to remove duplicate numeric entry points. |
| `src/shared/lines.js` | `keep`, `document` | Good narrow line-index helper. |
| `src/shared/logging/config.js` | `keep`, `document`, `test` | Keep logging config normalization focused on logging-specific inputs rather than turning it into a general env/config facade. |
| `src/shared/logging/warn-once.js` | `keep`, `document` | Good shared duplicate-warning suppressor. |
| `src/shared/merge.js` | `split`, `document`, `test` | Separate merge mechanics from JSONL run-file concerns. |
| `src/shared/metrics/core.js` | `keep`, `document`, `test` | Keep the shared metric registry core stable and split growth into explicit metric families around it. |
| `src/shared/native-accel.js` | `keep`, `document` | Keep as a specialized no-go feasibility contract. |
| `src/shared/number-coerce.js` | `keep`, `merge`, `document`, `test` | Make this the canonical numeric coercion surface. |
| `src/shared/observability.js` | `keep`, `document`, `test` | Clear correlation and context propagation boundary; keep separate from metrics. |
| `src/shared/ops/failure-injection.js` | `keep`, `document`, `test` | Keep operational failure-injection behavior under the explicit ops family. |
| `src/shared/ops/health.js` | `keep`, `document`, `test` | Keep operational health checks under the explicit ops family. |
| `src/shared/ops/resource-visibility.js` | `keep`, `document`, `test` | Keep resource diagnostics under the explicit ops family. |
| `src/shared/optional-deps.js` | `keep`, `document`, `test` | Good optional dependency probe surface. |
| `src/shared/order.js` | `keep`, `document` | Good higher-level ordering surface above sort.js. |
| `src/shared/path-normalize.js` | `keep`, `document`, `test` | Keep as the canonical path normalization layer. |
| `src/shared/progress-context.js` | `removed`, `document`, `test` | Moved to `tools/tui/supervisor/progress-context.js`; the only live owner is TUI supervisor child-process env propagation. |
| `src/shared/progress-events.js` | `keep`, `document`, `test` | Keep shared progress event typing and helpers in a dedicated narrow module. |
| `src/shared/repo-cache-config.js` | `keep`, `document`, `test` | Keep repo-cache config ownership explicit instead of hiding it in tools. |
| `src/shared/repo-paths.js` | `keep`, `document`, `test` | Keep repo path resolution in a dedicated helper instead of mixing it into generic path buckets. |
| `src/shared/reuse-diagnostics.js` | `keep`, `document`, `test` | Coherent reuse observation and summary surface. |
| `src/shared/runtime-envelope.js` | `removed`, `document`, `test` | Root facade removed after consumers moved to `runtime-envelope/resolve.js` and `runtime-envelope/env-patch.js`. |
| `src/shared/runtime-envelope/env-patch.js` | `keep`, `document`, `test` | Keep env patching separate from parsing and resolution policy. |
| `src/shared/runtime-envelope/parse.js` | `keep`, `document`, `test` | Keep runtime-envelope parsing separate from env patching and resolution. |
| `src/shared/runtime-envelope/resolve-current-process-envelope.js` | `keep`, `document`, `test` | Keep current-process envelope derivation as a narrow runtime-envelope leaf. |
| `src/shared/runtime-envelope/resolve.js` | `keep`, `document`, `test` | Keep runtime resolution separate from parsing and env patching. |
| `src/shared/search-request.js` | `keep`, `document`, `test` | Keep shared request normalization out of legacy tool-local wrappers. |
| `src/shared/sort.js` | `keep`, `document` | Intentionally tiny primitive comparator; keep it that way. |
| `src/shared/time-format.js` | `keep`, `document` | Good tiny duration-format helper. |
| `src/shared/toolchain-env.js` | `keep`, `document`, `test` | Good narrow toolchain env patch helper. |
