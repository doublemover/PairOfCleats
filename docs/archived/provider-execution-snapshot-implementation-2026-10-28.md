# Provider execution snapshot — 2026-10-28

**UNVALIDATED source:** `cf969e46d74f6b99d1f56f142ed298efc4b60c91`, tree
`9c0986745a59a6eed81a985adca66bb5bb867f3b`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The original invocation capability joined observed profile and source/config
identities but omitted its callback's actual environment and working directory.
Even a compliant trusted adapter capturing a different environment could produce
the same durable invocation key. Checking the same executable bytes did not
distinguish those runtime inputs.

Preparation now requires an immutable bounded concrete execution snapshot.
Configured/resolved argument arrays must match the observed profile; module
selection must match its observed file hash. The capability passes that exact
private snapshot to the original once-only callback. Its digest includes working
directory, full explicit environment, platform/architecture/Node and project
profile. Raw environment values never enter the serializable witness or cache.
Unknown environment is refused. The invocation witness is version 2, and shared
LSP semantic producer 59 invalidates prior derived meaning. The observed profile
format remains version 1; no public CLI or configuration is introduced.

The original successful result observation also survives all post-execution
profile/input verification and output projection. A later independent verification
failure retains that prerequisite. Projected resource observers keep their original
receiver instead of rebinding methods to a spread object. Independent errors and
original pending work remain separately required; no operation is replayed.

Thirteen `tooling/providers/provider-execution-snapshot/*` controls are authored,
**unexecuted**: environment/cwd identity, command/argument/configured mismatch,
observed/unobserved module selection, missing environment, immutable caller
snapshot, coalescing, original observer receiver, late pending work and independent
post-result failure. The thirteen existing orchestrator/cache join controls now
provide concrete execution snapshots and retain their original assertions.

Format/ESLint, four JavaScript syntax checks and whitespace passed. Shared-module
analysis found zero cycles; script inventory generation did not change output.
No functional fixture, child, native operation or benchmark ran. #1146 remains
partial: actual built-in launch/module/project wiring and provisioning/SDK/doctor
report reconciliation still require implementation and qualification. Current
source classification remains **481 pending / 144 partial / 93 unresolved** of
718 open issues. This source is local/unpublished; the publication gate is deferred.
