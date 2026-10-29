# Windows contract repairs at checkpoint 305

Eight repairs follow the dependency-security publication at `74ee1bd73`.
**40 affected checks pass at `cb64a38e3`**; six further warning/consumer checks
pass with the final contributing-warning repair. All use 30-second fixture
deadlines, one job, zero retries and native-status redo disabled. The
[durable receipt](windows-contract-repair-checkpoint-305-2026-10-28.json) retains
source identities, working-source hashes, every outcome and earlier failures.

- **Clangd admission:** normalization no longer invents an explicitly empty
  compilation-database selection. An absent database remains a missing-context
  observation; explicitly empty/invalid selections still fail. `lspBindings65`
  invalidates the changed producer inputs. All 25 database controls pass.
- **Controlled provider fixtures:** the command-path helper no longer imports
  and registers providers before collector hooks are installed. Positive cases
  exercise the actual preflight/dispatch owner with their intended inert
  collector; changed source, response files, launch arguments and invalid
  selection negatives remain. This is not native Clangd qualification.
- **Returned aggregates:** a returned bounded typed-array view/copy consumes
  its current values before the function exits. Its own return no longer
  invalidates that operation as an earlier escape. Unsupported containers,
  captures and calls retain their fences. Original trace/summary, overwrite,
  slice-boundary and backend-parity assertions pass. `cfgFlow32`/`callFlow51`
  prevent reuse of earlier meaning. The work-count fixture now passes only its
  declared count to `sample`: `map(sample)` had passed callback indices as a
  view-mode flag, comparing different workloads. Limits remain unchanged.
- **Service jobs:** full builds use their streamed Stage3 admission owner;
  explicit Stage2 retains its pipeline owner. The original full build admitted
  two jobs for one mode. A fresh-cache integration now proves exactly one job on
  both routes, bound to the command's selected generation and execution plan.
  Rejection/cancellation controls remain. Fixture Git launches stay hidden.
- **Provider warnings:** a useful contribution no longer suppresses an
  independently eligible warning/error from degraded-provider totals. The new
  regression fails before repair. Healthy contribution and planner-only
  exclusion controls remain. Saved diagnostics retain the sample's precise
  missing-database/weak-context observations; the operator line keeps its
  existing three-item presentation bound. API, observability and script-coverage
  consumers now pass alongside both TypeScript health controls.
- **Other harness repairs:** malformed ASCII and non-ASCII MCP headers have
  separate rejection vectors; federation cache-only policy uses its supported
  environment override while retaining cold/warm and per-repository ranking
  assertions; semantic SQLite plan checks use actual executed bindings while
  retaining both endpoint indexes and the no-table-scan requirement.

The [complete checkpoint-265 baseline](windows-full-validation-checkpoint-265-2026-10-28.md)
remains revision-specific and failing. Queued vector-only dense readiness and
publication remain open; eliminating duplicate jobs does not establish ready
vectors. No public CLI/config/schema admission was relaxed, assertion or test
removed, deadline extended or failure retried into acceptance.

Checkpoint 305 is the next 20-commit boundary after `7b05a3dbd`. Freeze it after
the publication gate, rediscover every fixture, reconcile explicit Windows
cohorts and run the complete applicable suite. Native lifecycle/performance run
serially; correctness keeps bounded concurrency. Physical links, POSIX/Linux,
optional backends, real models and release qualification retain separate owners.
Raw `.tmp/` results are historical author-workspace evidence.

All eight publication checks pass, including **40/40 gate cases**. The generated
configuration inventory records only new references to existing environment
keys; no key, allowance or budget is added.
