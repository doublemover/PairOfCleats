# Storage write admission inventory lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The actual cooperative write-admission owner enumerates existing reservations
through `withStorageDirectory`. It keeps the original opened `Dir`, captured
read/close methods, admitted native read drain and independent original-work
prerequisites. All existing reservation field, host, identity, entry-count,
declared-byte and hard-budget checks remain in place. Only an ordinary missing
directory before callback admission becomes an empty inventory; a failed read or
close of an observed directory cannot become an empty reservation list.

Before coordinator release, acquisition captures the original failure observer
and all diagnostic inspection errors. An independent observer applies even when
the pending marker is absent or false. Unknown original inventory, descriptor,
free-space or inspection work keeps the actual existing admission lock held.
Replacing the outward observer or supplying a recipe receipt cannot settle that
work. Ordinary confirmed failures and budget denials preserve their normal error
identity and coordinator release behavior; falsey failures retain their exact
cause when cleanup independently fails.

The existing `storageAdmissionSession` exposes only reconciliation of that exact
coordinator and any already sealed actual reservation. The existing capability
array and session remain nonenumerable. A pending inventory FileHandle or Dir is
also exposed only when its original producer validates the actual private
capability. Arbitrary properties, resource IDs and cause-chain traversal grant
no release authority. Recovery orders are explicit: settle an actual retained
reservation descriptor first, then its directory, then the admission coordinator.
No directory read, accounting probe, publication or reservation acquisition is
replayed by coordinator reconciliation. There is no second namespace or registry.

The authored actual-consumer fixture seeds its canonical reservation with the
real producer. It covers original native observations before directory close and
coordinator removal, original method replacement, falsey/frozen read plus close
errors, successful enumeration plus failed close, pending initial ENOENT,
readonly independently pending diagnostic inspection, pending free-space owner,
falsey primary/coordinator cleanup composition, counterfeit capability fields,
and actual nested reservation FileHandle/Dir/coordinator recovery. Positive
budget denial and subsequent valid admission remain. Existing reservation bytes
stay unchanged, and exact recovery never repeats accounting or reads.

This batch covers initial acquisition and inventory adoption. Returned
reservation settlement's own cleanup composition/retry prerequisites and atomic
receipt publication's descriptor lifecycle remain separate open work. The lock
is the existing cooperative metadata coordinator, with its existing cross-process
limits; this adds no durable native-work proof, PID inference, eviction, deletion
authority or automatic native retry. External teardown is not settlement. No
tests, syntax/lint/format, bootstrap, native/platform/full-index or performance
acceptance has run; no completed issue or executable qualification is claimed.
