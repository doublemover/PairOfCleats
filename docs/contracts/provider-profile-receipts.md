# Observed provider profiles

Implementation status: UNVALIDATED. Fixtures are authored and unrun; no real tool is qualified by this document.

`observeProviderProfile` snapshots bounded canonical declarations before I/O and admits their file count before observation. Negative/executable resolution requires original resource settlement before error-code inspection or ordinary absence. It reads a bounded, explicitly selected inventory. It does not discover PATH tools, execute commands, resolve dependencies, install packages or grant repository execution. The build/launch owner supplies configured and resolved argument arrays, observed version and API profile separately from adapter and contract versions. Executable/module bytes, pinned source bytes, canonical repository root, target variant, project configuration, SDK files, VFS mapping and positive/negative resolution entries contribute to the receipt hash.

A self-reported version alone never permits durable reuse. Empty executable inventory, a resolved executable absent from the observed file inventory, unknown read dependency closure or an install/runtime tool identity mismatch produces a non-durable receipt with reasons. A negative resolution becoming present is rejected. `verifyProviderProfileReceipt` takes an immutable JSON snapshot and rechecks every recorded byte, contained authorized root and negative dependency within the original read bounds. The orchestrator rechecks before cache admission, before consumption or invocation, and after a live provider settles. The JSONL process/host row writer and request-local refinement use the same check. A serialized old receipt is provenance, not a fresh filesystem observation or an execution grant. Existing TypeScript trusted module loading and native compiler authority remain mandatory.

The tooling orchestrator admits host-supplied `providerProfiles` into durable cache identity only through an original execution owner. A complete observation alone cannot prove which command or module produced this invocation's output. Providers declaring `profileContractVersion: 1` run live without qualified profile provenance when that join is unavailable. A supplied profile also cannot qualify legacy execution without the join; ordinary legacy providers without a profile retain their existing presentation-cache policy. Wiring each built-in launch and provisioning/doctor receipt remains pending. No new user configuration surface is introduced.

The internal `prepareInvocation(ctx, inputs)` hook observes the actual selection
without starting a child or retaining resources in a discarded plan. A trusted
adapter can use the SDK's `createObservedProviderInvocation` to capture its actual
execution callback and freshly observed profile. This is an in-process capability,
not a serialized command or execution grant. Its original callback must bind the
selected command/module, arguments, environment and project context; merely
copying a host receipt does not establish those observations. Unknown dependency
closure remains non-durable under the existing profile contract.

The helper requires a concrete bounded `execution` snapshot: `kind` is `command`
or `module`, `cwd` is absolute, `environment` is the complete explicit string
environment, and configured/resolved command arrays equal those observed in the
profile. A module also supplies its absolute path and matching observed SHA256.
The helper freezes a private copy and passes it to `execute(snapshot)`; adapters
must execute from that snapshot. It starts no child during preparation. Its
version 2 invocation witness includes an execution digest covering environment,
working directory, runtime and project context. Raw environment values remain
private and are not cached or reported. An omitted environment cannot qualify.

The orchestrator compares the complete observed profile, provider/version and
selected source/target/configuration context before cache admission. Qualified
execution calls that captured owner instead of independently calling a provider's
resolving `run` method. Source bytes, language/segment mapping, targets, generation
and effective tooling configuration bind its invocation identity. Profile/input
identity is rechecked before use and publication; the helper also verifies before
and after its coalesced once-only callback. Serialized/copied capabilities cannot
execute. Qualified cache entries retain the exact invocation witness. A missing or
mismatched owner takes an explicitly unqualified live path; a failed admitted
invocation produces required-computation failure and no cache publication. Original
pending ownership remains independently required. Existing TypeScript and native
execution authority is unchanged; this hook cannot grant repository trust.

LSP semantic producer version 62 invalidates prior derived replay after this
provenance change. Built-in Clangd and other adapters lacking the hook currently
use the unqualified live path even when a host supplies a complete observation.
The invocation framework is not a claim that every built-in launch is integrated.

The fixture `tooling/providers/provider-profile-source-identity` covers changed binary bytes with the same version string, SDK/config changes, unknown closure, missing dependencies becoming present, changed source, cancellation and receipt immutability. Root relocation, generated-source maps and installed-tool discovery still need integration fixtures before issue #1146 can be considered complete.

Thirteen unexecuted `tooling/providers/provider-invocation-profile-join/*` cases
exercise actual orchestration/cache publication with inert captured/live owners,
including tool/argument/variant mismatch, absent profiles/owners, changed source
and same-version tool bytes, policy drift, failed/pending execution, coalescing
and serialized-capability refusal. These are authored coverage, not execution or
real-tool qualification.

Built-in preparation can select commands through the same read-only discovery
and policy owner as real preflight, using `resolveToolingCommandSelection`.
Eligible selection has `probe.ok: null` and no attempted probes; it is not runtime
qualification. Real `resolveToolingCommandProfile` performs its existing probe
after that shared selection. Repository/workspace authority still applies before
either result can reach a launch owner.

Thirteen additional unexecuted `tooling/providers/provider-execution-snapshot/*`
controls cover launch-input identity, module/command mismatch, private immutable
environment, coalescing and original result ownership during later verification.
The [source receipt](../archived/provider-execution-snapshot-implementation-2026-10-28.md)
records the exact candidate and remaining built-in integration.
