# File-lock failure presence

Worker and lock-release rejection are explicit outcomes, independent of the
truthiness of a thrown value. A worker rejection of `undefined`, `null`, `false`,
zero or an empty string remains a rejection after successful lock release.
Fulfilled work returning those values retains its success result.

When release fails, the existing `ERR_FILE_LOCK_RELEASE_FAILED` error preserves
the exact release rejection as its cause and the exact worker failure in
`workerError`, including an explicitly supplied `undefined`. A false release
result remains unconfirmed and has no fabricated thrown cause. Release options,
lock identity and exclusion authority retain their existing contracts.

The authored regression covers actual disposable lock admission and denied
metadata removal, frozen unlink errors and inert exact release controls. It is
**UNVALIDATED**. No test, formatter, bootstrap or Windows fault qualification has
run for this change; it grants no cleanup or retry capability.
