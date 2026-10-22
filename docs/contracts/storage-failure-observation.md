# Storage failure observation

Status: UNVALIDATED source and authored controls, 2026-10-22.

The original-resource guard formerly owned by tooling prerequisite reporting now
lives in `src/shared/storage/failure-observation.js`. Provisioning uses an adapter
that preserves its existing phase and guard interfaces. Storage policy reading
uses the same guard before classifying failures as missing or invalid. This
consolidation adds no resource lease, cleanup authority, or settlement recipe.
The shared diagnostic context loads coordinator-lock cleanup lazily, so reading
policy does not eagerly import the lock-release graph through this guard.

The guard captures the original observation and receiver before inspecting
diagnostics. A false or absent pending marker cannot override a false original
observer. An unreadable marker remains unknown, and an observer or diagnostic
getter failure retains both original and independent inspection causes. Report
projection checks the captured observation again after protected code/message
reads and copies strings without coercing arbitrary diagnostic objects. Ordinary
falsey failures are normalized before projection, so producing the existing
invalid-policy report does not throw a replacement `TypeError`. Only a settled `ENOENT` before reading the locator can
produce the missing-policy defaults; a missing selected receipt remains invalid.

The persistent command-probe cache propagates actual guard-produced policy
failures during initial admission and policy rechecks. This private recognition
does not trust serialized properties, error codes, cause chains or phase labels.
It prevents pending or unreadable policy work from becoming an optional cache
miss, successful write, or invalidation report. Ordinary invalid policy still
bypasses cache use and preserves existing bytes.

The authored `probe-policy-failure-observation` fixture uses actual disposable
policy selection/receipt bytes, actual persistent-cache read/write/invalidation
owners and inert filesystem failures. It covers falsey errors, frozen original
observers, receiver and replacement negatives, independent message/code
inspectors, unknown markers, pending `ENOENT`, original-state changes during
classification, and policy rechecks before cache consumption/mutation. Existing
provisioning failure fixtures retain their original consumer assertions. No
fixtures or executable checks have run for this source batch.

This is a report-propagation repair. The existing contained-file/cache reader
descriptor-close lifetime, cache writer admission/Dir cleanup lifetime, generic
coordinator release prerequisites and cross-process native settlement remain
separate open work. A propagated error or metadata release does not establish
that an original native resource has closed. No native, CLI, bootstrap, platform
or completed-issue acceptance is claimed.
