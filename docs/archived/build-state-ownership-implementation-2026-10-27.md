# Build-state resource ownership — 2026-10-27

**Unvalidated source:** `1aa491181b723d932a9f82c5a8a066cecf5e3af5`, tree
`81429d95f783ac8d39807aae5aacf7547d979011`. Branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Local implementation checkpoint, not pushed or functionally qualified.

The original store could discard an independently rejected sidecar, release its
coordinator around pending native work, replace a work failure during release,
or acknowledge a required write after its selected root disappeared. Append
cleanup could discard the original write/sync failure. The queue could then
replay failed required work without an explicit caller and classify errors before
observing their original native ownership.

The repair uses the existing storage observation/composition, contained descriptor,
atomic publication and actual file-lock publication/release owners. It adds no
parallel lock, lease, garbage collector or path-derived recovery authority:

- Write/lock diagnostics keep exact original causes, captured observers and
  independent getter/inspection failures without coercing arbitrary diagnostics.
  Error reports are bounded and redacted; falsey failures are counted.
- Preparation finishes before sidecar/main dispatch. Every started sibling is
  drained and every rejected sibling survives in deterministic input order.
  Rotation pruning also drains and retains all failures; unexplained filesystem
  errors no longer become absence.
- The actual coordinator uses `releaseFileLockOrThrow`. Unknown original work
  retains its publication session; release failure preserves the original work
  error. Best-effort durability cannot imply an unknown coordinator was released.
- Append/write/sync/close use one captured original FileHandle owner. Explicit
  recovery can close that descriptor but never repeats the write. Unsupported
  directory sync is tolerated only after the original operations and close are
  confirmed.
- Required missing-root admission rejects. Follow-up state, progress, checkpoint,
  compressed archive and append writes do not recreate their selected parent.
  The existing lock helper gains internal `createParent` selection (default
  unchanged); this follow-up writer selects false, covering the admission/open race.
- The existing queue captures original and diagnostic prerequisites inside its
  serialized action before later detached native work. Pending owners block
  explicit flushes and new patches; admitted waiters reject instead of hanging.
  Required failures retain their payload for explicit recovery and never schedule
  background replay. Settled best-effort retry/backoff remains. Timer-driven
  rejections are consumed. Logical pending-byte telemetry includes failed work.

Twenty **unexecuted** cases are authored:

| Discovered family | Cases / boundary |
| --- | --- |
| `indexing/build-state/store-resource-ownership/*` | 7: actual state/sidecar/coordinator publication, ordinary success, missing/denied/retired roots, preparation-before-dispatch, independently pending siblings and diagnostics |
| `indexing/build-state/append-resource-ownership/*` | 6: original FileHandle append/sync/close, simultaneous errors, pending original work, close-only recovery and missing parent |
| `indexing/build-state/queue-resource-ownership/*` | 7: actual queue with virtual clock/inert writer, required replay refusal, pending/captured/getter owners, detached waiters, settled best-effort retry and retained-byte accounting |

Existing state ordering, live coalescing, contract/rotation/checkpoint, runtime
receipt, file-lock and descriptor cases remain required. They were not removed
or weakened. New file cases use disposable task directories without physical
symlinks, elevated tokens, subprocesses or native addons. These controls do not
qualify full build/category/storage teardown or actual child/native lifecycles.

Format/ESLint, changed JavaScript syntax, config budget, generated command
inventory and whitespace checks pass. Shared-module analysis reports zero
cycles. No functional fixture, benchmark or publication front gate ran.

This addresses source-confirmed lower-store prerequisites for #1574 and failed
receipt persistence in #1325. It does not attribute the access violation, close
either issue or complete #1267. Custom/external backend registration, remaining
sidecar/legacy/category adoption and current-candidate functional qualification
remain separately tracked.
