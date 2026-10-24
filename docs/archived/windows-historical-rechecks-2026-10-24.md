# Windows historical failure re-checks, 2026-10-24

This receipt covers the **459 historical failures** left unobserved after the
preceding targeted repairs. The [machine-readable inventory](windows-historical-rechecks-2026-10-24.json)
retains every selected ID, cohort, outcome, duration, deadline and exit status.
The [preceding receipt](windows-solo-validation-2026-10-23.md) retains the earlier
145 passing observations, including 91 of the original 550 failed IDs.

## Frozen baseline

- Branch: `codex/pr557-audit-repairs-20261012`.
- Commit: `893fe089458e7f7294b8d1f357f596fdecc7d5d4`.
- Tree: `959660a0f46f017ddf6706791392c85e1641e39c`.
- Windows x64, OS build 26300, Node 26.12.1, ABI 147.
- Fresh native/patch verification exited 0 without warnings or errors. Eight
  patches, 26 target files and 61 hunks verified without modifying dependencies.
  Activation evidence remains distinct from runtime qualification.
- Current discovery matched every selected ID. Seventy explicit cohorts selected
  each once. Correctness used at most four processes; 49 native, lifecycle,
  API-contract and import-budget cases ran serially. Indexing used one thread.
- Every case used a 30-second deadline, zero retries and native-status redo
  disabled. Source and HEAD stayed unchanged. Remote history matched this HEAD.

| Baseline outcome | Count |
| --- | ---: |
| Passing | 32 |
| Failed, including timeouts | 426 |
| Timeouts within those failures | 10 |
| Explicit platform exclusion | 1 |
| Recorded native access violations | 0 |
| Missing or duplicate selected IDs | 0 |

`tooling/script-coverage/tools/shell-scripts` explicitly requires POSIX wrappers.
Windows did not launch Bash or WSL; this exclusion is not a pass. Exit codes and
transcript searches found no new `0xC0000005`, which does not replace earlier CDB
attribution or broader native/TUI qualification. Some passing build fixtures emit
degraded/optional-route diagnostics; runner success is not warning-free runtime
acceptance. No rebuild, cache invalidation, elevation or security-setting change
was used for these observations.

Author-workspace `.tmp/tasks/windows-historical-rechecks-20261024/` contains the
plan, immutable candidate's cohort reports/transcripts and progress inventory.
These ignored files are historical local receipts, not promised in clean clones.

## Demonstrated repairs

- `965cdba70`: thrown `null` no longer matches the empty retirement-error
  sentinel. Embedding, Transformers, ONNX and map owners preserve the original
  cause, reconciliation capability and pending state. Undefined/null/false/zero/
  empty-string controls remain, including explicit retry without automatic close.
  Acquired deferred embedding leases accept operations before immediate disposal;
  disposal during unfinished acquisition still cancels dispatch.
- `0ee78e7da`: equivalent immutable semantic writes serialize through temporary-
  link removal, which previously changed the inode's ctime during a peer's
  verification. A separate retention lane avoids re-entering the caller's source
  writer. Receipts now describe the file after cleanup; differing byte lengths
  retain the existing integrity error. Exact bytes, containment, failed original
  native closure, disk credits, cancellation and source receipts remain covered.
- `19f8459a3`: CI now checks the explicit current 19 installation/verification
  steps, including both native-inspection steps. Every step retains the CPU
  download policy; the real locked installer makes no forbidden network request
  and a tiny native CPU graph executes. Simulated LSP qualification explicitly
  trusts its fixture repository and exact generated protocol workspace. All 12
  diagnostic/process/protocol cases pass, including untrusted-command and
  non-testing rejection, timeout, shutdown and descendant-reaping negatives.
- `df59da467`: explicit ONNX resource release could dispose inference tensors
  while their operation still ran. A retained invocation scope now refuses early
  disposal. The production-owner regression fails before and passes after the
  repair, asserting no early tensor/session/tokenizer close, retained references
  and exact final closure. Nine affected ONNX cases pass, including inference,
  prewarm, output pooling, CPU tuning, queue recovery and independent failures.
  This proves a lifecycle defect; it does not attribute a newly observed crash.

Synthetic ONNX output now has valid float storage and batch dimensions instead
of `{}`, retaining every lifecycle assertion. Startup negatives keep tokenizers
until original external work settles. The map dual-observer fixture likewise
blocks disposal until both original receipts settle, then proves one successful
retry and no repeated close. Production admission and trust were not relaxed.
These ownership repairs do not change stored semantic meaning or artifact formats.

## Current observations and remaining work

Focused repairs have **36 distinct passing IDs**, including **16 baseline
failures**. The first 29-case selection exposed the additional ONNX defect;
after its repair all nine affected ONNX cases pass. Unchanged observations retain
their own source checkpoints. Original and intermediate failures remain separate.
Source checkpoint is `df59da467921d207efe7d804b0daed29b787842f`;
tree `18de5fae18064fa431109937f9e193b5da9eb6ce`.

The ready-batch front gate passes: formatting, configuration budget, environment
usage, generated freshness, command surface, workflow contract, all 40 gate cases
and whitespace. No unexpected warning appears in those check transcripts. The
Markdown link check also passes. The inherited nonexistent trusted-config path
was removed only from the check subprocess environment, without changing user
or machine configuration. The JSON inventory records the focused observations
and gate separately from the frozen baseline.

Within the selected historical inventory, observations at that checkpoint are **48
passing, 410 failing and one platform exclusion**. This is not a second frozen
459-case pass. The [next repair wave](windows-failure-repairs-2026-10-24.md)
adds 28 repaired historical failures and records 37 passing focused cases at
`adfdcc85b`: latest scoped counts become **76 passing, 382 failing and one
platform exclusion**. Its cache/setup follow-up adds ten more passing historical
cases: latest scoped counts are **86 passing, 372 failing and one exclusion**.
Source/validation observations remain separate waves in the JSON inventory.
All ten baseline timeout IDs remain unresolved:

- `shared/storage/probe-write-admission-preserves-unknown`;
- `retrieval/filters/semantic-filter-contract-matrix`;
- `tooling/script-coverage/tools/ci-restore`;
- `indexing/artifacts/determinism-report-artifact`;
- `indexing/chunk-id/backend-parity`, `indexing/determinism/symbol-artifact`;
- `indexing/embeddings/determinism`;
- `indexing/extracted-prose/document-chunk-id-no-collision`;
- `indexing/semantic/ssr-snapshot-witness-incremental` and its `-parity` case.

Continue by shared owner: original descriptor/publication/recovery failures;
explicit provider fixture selection/trust and preflight; semantic compiler,
replay and production content parity; canonical cache/artifact and SQLite
identities; language, editor and report contracts. Separate deadlocks/leaked
ownership from oversized aggregate cases before partitioning wrappers, retaining
every assertion and script-coverage claim.

The serial import check still exceeds unchanged transitive module budgets:
command-registry query 3/2, artifact I/O 89/73 and retrieval CLI 94/60. This is
an import-count failure, not measured latency evidence. Native terminal lifetime,
useful latency qualification, Linux/macOS, optional sqlite-vec, real-model and
release acceptance retain separate owners. No complete deep-suite, issue-closure
or backlog-completion claim is made.

## Hosted workflow follow-up

The [first published CI run](https://github.com/doublemover/PairOfCleats/actions/runs/40063882201)
at documentation head `c18c766b5` failed before creating any jobs. The same
pre-existing failure appears on earlier branch pushes. GitHub's annotation
identifies six job-level .NET/NuGet environment values using `runner.temp`;
[the context rules](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
permit runner context in step environments but not job environments.

`d0a834b7f` uses supported `github.workspace` paths under ignored `.tmp/ci/` for
those six values, retaining per-job isolation. A workflow guard now rejects
runner context in job env across every workflow, with dot/bracket negative
controls and permitted workspace, quoted-string and step-env positives. It fails
on the old CI file and passes on the repaired one. Formatting, the workflow
contract, the real CPU install-policy case and whitespace pass. Runtime source
and the 459-case observations above are unchanged; hosted CI execution remains
a separate observation from these local checks.
