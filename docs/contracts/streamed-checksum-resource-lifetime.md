# Streamed checksum resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

Standalone binary-columnar checksum streaming uses the shared original
descriptor owner in both contained and legacy paths. Payload reads remain
bounded to 64 KiB and consume an exact admitted regular-file extent. Invalid or
premature-zero progress and changed final stat identity fail before checksum
acceptance. There is no whole-payload materialization or fallback.

Checksum verification runs while the admitted descriptor is still owned, before
close. Original read/update/verify failures and independent close failures
therefore compose through the same owner. A pending original observation gates
actual descriptor destruction. Failed numeric close keeps its generation
unknown; explicit recovery cannot replay stream, hash update or verification,
and external cleanup cannot authorize another numeric close.

The existing public `ERR_ARTIFACT_READ` and `ERR_ARTIFACT_CORRUPT` classifications
remain distinct. The loader wrapper retains the exact original cause and
observations, including falsey/frozen values, and forwards only an actual private
contained-file capability. Buffer checksum failure wrapping uses the same
cause-preserving path. A successful checksum followed by unconfirmed close is a
read/resource failure and cannot admit the public row loader's decode pass.

The authored `streamed-checksum-resource-lifetime` fixture covers actual hashes,
disposable bytes/fds and both path modes: positive bounded short reads, all
falsey read plus independent close failures, valid/invalid checksum plus close
failure, original native predicate/replacement negatives, invalid progress and
no verification replay. It also creates a canonical binary-columnar family and
checks the actual public row loader emits no rows or second data open after
checksum-close failure, then retains a normal positive row control. No
executable checks have run for this batch.

This adoption does not repair the subsequent frame generator's raw descriptor
finally or retain index/category coordination on behalf of the caller. Validator
hooks remain the existing synchronous protocol. Native/platform/performance,
full-index and cross-process qualification remain deferred; no stronger numeric
generation proof or completed issue claim is made.
