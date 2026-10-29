# Windows Git admission deadlock — 2026-10-29

Base: `fe4ee1a058c9b688374a8cbe74399071658b13da`. The companion JSON binds
source identities, original failure receipts and focused checks. Task-local
`.tmp/` and `.testLogs/` files are historical author-workspace evidence.

## Cause and repair

Two hosted fixtures stalled while indexing the nine-file sample:
`retrieval/pipeline/ann-lazy-import` and `tooling/sublime/api-authentication`.
At `0cdb25a64`, both reached the 600-second runner deadline. The event loop
continued heartbeats; no file completed until a 360-second file deadline.

Fresh local caches and `CI=true` passed. Emulating four available CPUs, 16 GB
total memory and 8 GB available headroom reproduced the first fixture's stall
within the unchanged 30-second bound. The diagnostic snapshot showed nine
suspended file owners, eight running process owners (four suspended), four
queued process CPU resumptions and one pending process operation. CPU remained
available; the process concurrency cap was occupied by Git-queue waiters.

Git's PQueue held callbacks until command completion. A file waiting for its Git
slot retained CPU and process concurrency, preventing an earlier command from
reacquiring CPU and releasing that slot. PQueue could also invoke a deferred
callback in the preceding caller's async context.

`runGitTask` now queues a slot reservation, suspends CPU only while awaiting
admission, then executes provider work in the caller's admitted continuation.
The slot remains occupied until that work settles. File memory/bytes stay
charged; Git concurrency, command deadlines, signals and error identity remain
intact. Canceled admission releases its slot without invoking provider work.
Existing stall diagnostics now expose process queues and suspended owners.

## Proof

- The minimized regression failed before repair with an explicit Git admission
  deadlock error, then passed after repair. It checks original file-lease
  identity, admitted parsing, bounded Git concurrency, retained memory/bytes,
  cancellation, frozen error identity and slot reuse after failure.
- Both original fixtures pass with fresh caches and the same four-CPU/16 GB
  control: 10.288 and 11.958 seconds. Original assertions, backends and inputs
  remain unchanged. The resource preload is a diagnostic control, not a
  production setting or acceptance workaround.
- Ten focused scheduler/SCM fixtures pass with zero retries and no skips.
  The new regression belongs to the 1,482-case ordered CI-lite inventory.
- Publication checks and exact source hashes are recorded in the companion JSON.

No native access-violation cause is inferred from this JavaScript deadlock.
The hosted repair and broader integration campaign require their own candidate
results; no full-suite pass is claimed.

## Preceding hosted qualification

At exact head `fe4ee1a05`, run `40868324341` passes all 43 Windows authority
fixtures and all three native-inspection jobs. Windows native cohorts pass
34 terminal/artifact/index cases, 12 PTY lifecycle cases, 19 parser/patch cases
and four semantic cases. The former validate/search and workspace failures pass
in 21.4 and 21.6 seconds. macOS validate/search passes in 18.2 seconds after
canonical fixture seeding moved outside the native application clock. These
results retain their earlier source identity; they do not qualify this repair.
