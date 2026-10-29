# Windows security and validation follow-up

At `bfa2e8beb`, **76 of 77 required affected cases pass**, with one known queued
vector-only readiness failure, zero timeouts and zero skips. The
[durable receipt](windows-security-and-validation-followup-2026-10-28.json)
retains every outcome, source identity, report hash and explicit exclusion.
The complete checkpoint-265 baseline remains failing; these are focused repairs.

## Dependency security and setup

Hosted CI stopped at its live dependency audit before executing tests. The
October 28 advisories affect the installed Hono server adapter and RE2JS:
[GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f) and
[GHSA-gg6h-894w-4m9c](https://github.com/advisories/GHSA-gg6h-894w-4m9c).
The SDK's existing range admits `@hono/node-server` 2.1.5; the lock now selects
it instead of 1.19.17. The direct RE2JS floor and lock select 2.8.7 instead of
2.8.6. Only these two resolved package records and root metadata change.
Historical advisory fixtures remain, with a new reviewed baseline for both
ranges. The product's actual RE2JS consumer still rejects opt-in lookbehinds.
Live audit admission and its severity threshold remain unchanged.

Fresh **`npm run bootstrap:ci` exited 0** on Node **26.12.1**, Windows x64, ABI
147. The complete log contains **zero warning/error lines**. It verified 37
required packages, activated 33 parser routes and verified eight patches across
26 files/61 hunks. The absent optional Sharp package is recorded separately.
The subsequent full dependency audit reports **zero vulnerabilities**.
The pre-install and post-install inventories each contain 225 native binaries;
the receipt preserves the nine changed/rebuilt identities and inventory hashes.
Node-PTY binaries did not change. Setup activation remains distinct from runtime
and native lifecycle qualification.

## Debugger failure ownership

A deliberate native-shaped exit is not an access violation. Windows can expose
its numeric process status as signed or unsigned; the child fixture now checks
the exact `0xC0000005` bit pattern, nonzero exit, null signal and absent dump while
preserving the runtime's raw status. Identity, output and phase controls remain.

The focused run then exposed a real collector defect: when debugger launch
failed, reading the absent child receipt threw before the original launch error
was composed into the final result. Every final failure path now preserves the
launch/monitor error alongside independently failed capture work. The regression
requires both the original error identity and the missing-receipt error. All
selected synthetic child/collector cases pass. This does not establish a new
native crash cause or qualify an actual CDB capture.

## Artifact validation

Vector-only profiles intentionally omit sparse postings. Their resolved sparse
requirement now reaches the postings validator; present, declared or corrupt
sparse artifacts still receive validation. Required dense artifacts remain
required. A second defect affected nonstrict optional loading: undeclared,
physically absent optional inputs were loaded as if present. That owner now
distinguishes absence from declared-missing, errored, present and legacy inputs.
The new real-artifact regression covers strict/nonstrict profiles, required dense
failure, normal-profile sparse requirements and corrupt/declared-missing inputs.

The original service fixture **still fails** because queued work has not yet
produced dense artifacts when full validation/publication runs. Queue acceptance
does not establish retrieval readiness. Its success assertion remains intact;
no pending-state publication waiver or backend workaround was introduced.

## Selection and next acceptance

The initial 80-case selection recorded 76 passes, three failures and one POSIX
skip. The collector and optional-input failures are repaired and pass in the
final selection. Two physical-link cases inadvertently included in the initial
selection are explicitly excluded from the final required cohort; their
incidental passes do not qualify physical-link acceptance. The POSIX descendant
case retains its Windows cancellation/progress coverage owner.

All required cases ran with one job, a 30-second fixture deadline, zero retries
and native-status redo disabled. Raw `.tmp/` logs/inventories are historical
author-workspace receipts and are not promised in clean checkouts. Durable
results retain exact inputs and hashes. Linux/macOS, physical links, optional
backends, real models and release acceptance remain separate.

All eight publication front-gate checks pass, including **40/40 gate cases**.
The first freshness check caught the active roadmap exceeding its existing
20,000-byte CRLF bound. Condensing superseded historical prose repaired it; the
limit and freshness check remain intact. Both observations are retained.

The next full validation is due at **checkpoint 305**, twenty commits after
checkpoint 285 (`7b05a3dbd`). Rediscover/reconcile the complete Windows inventory,
retain explicit exclusions and run native lifecycle/performance serially. The
full-suite result must belong to that frozen candidate; earlier green checks
cannot be combined into a final-tree passing claim.
