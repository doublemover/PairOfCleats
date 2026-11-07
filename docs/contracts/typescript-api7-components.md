# Experimental TypeScript7.1 components

The explicit `typescript-api7-request-snapshot-v1` offline adapter currently
exposes component preparation. The structured runtime adapter is still being
implemented; preparation does not establish API, snapshot or disposal qualification.
The existing compiler bridge and native LSP remain separate consumers.

Preparation installs the official TypeScript7.1.0-beta JS SDK and the matching
Windows x64/arm64 native package through the existing immutable managed archive
owner, serially. Exact archive bytes/SHA512 and the target/version are pinned.
Each archive retains the original1GiB extraction ceiling, inclusive archive and
metadata allocation, full file inventory, original verification observations,
staging/recovery and selector publication. Other targets are explicitly unsupported.
No npm install, package hook, CLI shim or machine PATH change is performed.

Component IDs include role, version and platform/architecture. A later version
gets distinct owners, preserving an earlier pair's selectors and active leases.
An incomplete new pair cannot fall back to an older SDK/native combination.
Both archives retain their own original provenance; no concatenated digest,
adopted secondary download or altered installation format is introduced.
The SDK vendors its JavaScript dependencies. Its platform package dependencies
are optional, and the planned runtime supplies the exact native process rather
than invoking the SDK's default package lookup/spawn path.

Activation checks actual SDK exports under the application Node and the exact
native CLI version, with original four-second child and64KiB output bounds.
SDK export probes do not construct an API session. Original probe observations
remain attached through verification/publication; rejected activation retains
the exact probe as a cause. Pending probes cannot fabricate affirmative
settlement, and every result explicitly says `runtimeQualified: false`.

Seven authored, locally unrun controls cover both target pins, independent
versioned owners, closed preparation, real Node transport over explicitly trusted
inert SDK modules, wrong SDK surface, original pending fields and retained
positive-result observations. POSIX runs assert the unsupported branch; their
refusal does not stand in for Windows positive execution. Vendor acquisition,
full/request-scoped filesystem authority, structured answers, snapshot identity,
actual native disposal and compiler-consumer parity remain required for #1155.
