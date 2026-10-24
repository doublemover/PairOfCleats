# Atomic write resource and rollback lifetime

Status: UNVALIDATED implementation and authored controls. The parallel wave runs
only exact-file formatting; runtime, platform and integration acceptance waits.

Atomic text, JSON and chunk writes use the existing contained-file resource owner
for the actual staging descriptor. Its optional internal write/writeFile/sync
operations capture original functions and receiver before any verification hook.
The same native-operation drain and original-observer prerequisites govern close.
Callbacks retain their existing FileHandle argument; ordinary payload and chunk
writes use captured operations. Chunk producers must await each borrowed write
and stop using their writer when they return, as before.

One automatic original close is attempted after admitted work. Failed FileHandle
close is retried only through its real existing contained-file capability; a
failed numeric synchronous close remains generation-unknown. Pending original
write/stat/sync/hook observations prevent actual close and all rollback. Falsey,
frozen, readonly and independent cleanup errors remain in the original failure
context. Public errors forward only validated actual descriptor capabilities;
error diagnostics cannot replace an already captured original observer.

Staging and create-only rollback require the sealed original device/inode,
birthtime, mode, size and modification time of an ordinary file. Single-name and
the writer's own two-name create-only link states are allowed; ctime changes from
the writer's link/unlink are not content authority. An unsealed, replaced, changed
or extra-linked pathname is preserved. Failed write can leave partial bytes whose
final extent was not sealed; those bytes stay as evidence rather than being
deleted by a generic pathname cleanup. Cleanup begins only after original close
and independent work settle. Cleanup failures compose and can block further
destructive cleanup; no catch retries a failed close or unlink automatically.

Create-only publication keeps its existing same-directory hardlink operation and
never changes to overwriting rename/copy. The new target is rolled back only for
failure before confirmed descriptor completion, after actual close and exact
identity revalidation. Once publication and descriptor close are confirmed,
staging cleanup or parent-directory durability failure preserves the committed
target. Error context reports the staging path and whether publication is
uncommitted, create/replace unconfirmed, linked unconfirmed or committed. A normal
replacement still uses one overwrite rename through the existing owner.

Parent-directory durability has its own exact descriptor owner. The directory
opened for sync must match the admitted parent device/inode/birthtime, remain a
directory, and match the final pathname observation. Original sync/close failure
is preserved and an unsupported-sync code cannot suppress unknown native work or
failed close. Existing platform unsupported open/sync cases remain tolerated
only after resource settlement. A file returned for a directory request fails
identity verification while its independent failed close remains retained.

The actual public-consumer fixtures are
`tests/shared/io/atomic-write-resource-lifetime.test.js` and
`tests/shared/io/atomic-write-sync-resource-lifetime.test.js`. They author original
method capture, text/JSON/chunk payloads, failed/nonvoid close and no-replay
recovery, falsey/frozen dual failures, original pending write/verifier work,
post-close rollback, replaced staging preservation, committed-target retention
and negative parent identity/close controls. Original atomic visibility,
exclusive-create, persistence and retry fixtures remain intact.

Known limits: close-only recovery does not replay publication or metadata cleanup;
retained staging/linked evidence needs a separately authorized recovery decision.
Portable pathname comparison plus unlink/rename is not an atomic compare-and-act
primitive against unrelated writers. The replacement/copy/backup helper's native
lifetimes and cross-device failure cleanup are separate follow-up work. This does
not add a coordinator/category lease, alternate resource registry, deletion
authority, global cache change or stronger cross-process guarantee. Native
directory support, crash durability, physical-link and performance qualification
remain deferred.
