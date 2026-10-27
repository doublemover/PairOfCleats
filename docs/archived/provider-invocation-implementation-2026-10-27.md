# Observed provider invocation join — 2026-10-27

**UNVALIDATED implementation:** source `d60d3cd10472a7dff0ab37764f5026d14107b970`,
tree `adcf8ce5f8ccfde7625a3ef740d19a1a8774544c`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Local source checkpoint; no functional/publication or real-tool acceptance.

## Fixed boundary

Previously a host could supply an intact observed profile for installation A
while a provider independently resolved/executed installation B. Rechecking A's
bytes before and after B did not make A the producer of B's output. Complete
profile observations alone no longer admit that cache or qualified provenance.

The optional internal `prepareInvocation` hook now returns an original in-process
execution capability, created through the SDK's `createObservedProviderInvocation`.
Preparation observes without launching or holding resources in a discarded plan.
The trusted adapter must capture its actual module/command, arguments,
environment and project selection in the callback and observed profile. The
capability is privately registered; copied/serialized data cannot execute it.
This is a provider contract, not a sandbox for trusted adapter code.

The orchestrator compares the complete freshly observed profile, provider/version
and actual selected source/target/configuration identity. A matched invocation
executes its captured callback instead of independently resolving `provider.run`.
Source bytes, language/segment mapping, generation, requested kinds and effective
tooling configuration contribute to identity. Known files/negative dependencies
are reverified through existing profile owners; unknown read closure still
cannot qualify. The callback coalesces once, original pending result ownership
blocks output, and input/profile drift blocks cache publication. Qualified
failure is required-computation failure with original pending causes retained.

Qualified cache identity and payload retain the exact invocation witness, which
is checked before reuse. Only the admitted capability supplies this cache
witness; arbitrary provider output cannot manufacture it. Cache/source/profile
checks run again at consumption/publication. LSP semantic producer version is 53
so derived replay cannot reuse the earlier provenance semantics.

An absent or mismatched execution owner takes an explicitly unqualified live
path: no durable entry and no observed-profile producer label. Ordinary live
execution without a profile remains. Native Clangd and other built-ins without
this preparation hook currently use that path. Installing a framework is not a
claim that all built-in command/module/environment/project owners are integrated.

## Authored checks and remaining scope

Thirteen **unexecuted** `tooling/providers/provider-invocation-profile-join/*`
cases exercise the actual orchestrator and cache with inert owners: matched
persisted reuse, different tool/arguments/variant, absent owner/profile, changed
selected source, changed same-version tool bytes, policy drift, execution-time
mutation, coalesced execution, copied-capability refusal and original pending
failure. They launch no executable, compiler, installer or browser.

Format/ESLint, changed JavaScript syntax, configuration budget and whitespace
checks passed. Shared-module cycle analysis found zero cycles; generated
configuration and command inventories were refreshed. No functional fixture or
front gate ran for this checkpoint.

#1146 remains open for built-in launch/module/environment/project integration,
SDK/doctor reporting reconciliation and complete acceptance. #289/#1161 retain
real compilation context/variant qualification. This checkpoint does not claim
all remaining provider or backend ownership work is complete.
