# Storage policy publication failures

Status: UNVALIDATED source and authored controls, 2026-10-22.

`applyStorageProbePolicy` retains the original publication failure when its
existing `storage-policy.lock` release also fails. Caught primitive values,
including `null` and `undefined`, become errors with the exact thrown value as
their cause before crossing the shared helper's legacy no-operation sentinel.
Frozen errors and readonly diagnostic fields remain on their exact original
cause. The independent lock-release failure is retained as an additional error.

The shared `releaseStorageOperationLock` exposes only its actual metadata handle
in nonenumerable `storageOperationLocks`. Retrying that handle uses the existing
exact lock identity and never repeats policy publication, finds another owner,
or changes cached bytes. Unknown diagnostic arrays do not grant lock authority.
Selection receipts, review identity, literal-zero semantics, conflict handling,
and the selected policy format are unchanged.

The authored `probe-policy-publication-error-lifetime` fixture faults the actual
selection-directory creation and actual metadata removal inside disposable
application homes. It covers all falsey publication/removal throws, frozen and
readonly causes, exact retained lock identity, release-only recovery, ordinary
successful cleanup, and successful reviewed policy publication. Existing
`probe-policy-reviewed-lifecycle` controls still cover policy changes and receipt
validity. None of these fixtures has been executed for this source batch.

This repair concerns failure composition and metadata recovery. A successful
metadata unlink does not prove native work settled. The shared coordinator
release helper does not independently defer unlink for original pending native
I/O, and the lower contained-file and atomic-write descriptor-close failure
lifetimes remain separate work. Cross-process and platform acceptance is
deferred with all other executable validation.
