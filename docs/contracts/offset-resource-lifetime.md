# Positioned offsets resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

Owned `readOffsetsAt` calls now borrow the existing async descriptor resource
owner after their actual FileHandle opens. `readOffsetAt` inherits this owner.
Original read/stat/close methods and receiver stay captured, and returned maps or
scalar offsets are withheld until native close is confirmed. Original read,
decode and independent close failures compose without losing falsey/frozen
causes. Original independent native observations gate actual close even after a
marker or method replacement. The existing exact FileHandle capability supports
explicit close-only recovery without rereading or decoding.

Caller-supplied handles retain their existing borrowed ownership and are never
closed by `readOffsetsAt`. Sorted/deduplicated index selection, safe u64 decoding,
exact-read/partial-offset checks, the four-MiB coalescing cap and individual reads
for distant offsets remain unchanged. No whole-sidecar fallback, new containment
or path mutation authority is introduced.

The actual per-file symbol fallback already guards privately retained descriptor
failures. Its authored canonical fixture now also checks a valid offsets result
followed by close failure cannot begin varint decoding or a full-artifact scan;
explicit original close settles without replay. The focused owned/borrowed
offset fixture uses actual disposable files/handles, bounded short reads,
replacement methods, distant offset windows, scalar withholding, falsey/frozen
read-plus-close errors, original native predicate replacement, unsafe decoded u64
plus close failure and unchanged source bytes. Existing positioned-short-read,
alignment and offsets validation controls remain.

This adoption is limited to the single-handle owned positioned reader. Raw
two-handle row readers, partial parallel admission, verified snapshots and
offsets validation still have separate cleanup contracts and open lifetime work.
It does not retain category/index/coordinator leases or establish durable
cross-process native settlement. No tests, syntax/lint/format, bootstrap, native,
platform, full-index or performance checks have run; no completed issue is claimed.
