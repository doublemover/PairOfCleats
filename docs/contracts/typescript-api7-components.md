# Experimental TypeScript7.1 components

The explicit `typescript-api7-request-snapshot-v1` offline adapter exposes
`prepare` and `run`. It implements independently owned SDK/native execution, a
full supplied filesystem, one fresh snapshot and versioned structured answers.
Implementation and authored fixtures are locally unrun. Preparation establishes
activation only; the existing compiler bridge and native LSP remain separate
consumers until their domain-specific promotion gates pass.

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
are optional, and the runtime supplies the exact native process rather
than invoking the SDK's default package lookup/spawn path.

Activation checks actual SDK exports under the application Node and the exact
native CLI version, with original four-second child and64KiB output bounds.
SDK export probes do not construct an API session. Original probe observations
remain attached through verification/publication; rejected activation retains
the exact probe as a cause. Pending probes cannot fabricate affirmative
settlement, and every result explicitly says `runtimeQualified: false`.

Seven component controls cover both target pins, independent
versioned owners, closed preparation, real Node transport over explicitly trusted
inert SDK modules, wrong SDK surface, original pending fields and retained
positive-result observations. POSIX runs assert the unsupported branch; their
refusal does not stand in for Windows positive execution. Vendor acquisition and actual runtime qualification are owned separately below.

## Request and source authority

`src/contracts/schemas/typescript-api7.js` owns the closed request and worker
answer contracts. Requests contain at most128 source/config/dependency files,
4MiB retained input,32 selected roots or configured projects and64 queries.
Queries select an admitted file and UTF-16 position, plus an explicit configured
project when needed. Duplicate/case-aliased paths, directory/file collisions,
Windows reserved names, traversal, external handles, callbacks, raw compiler
options, raw filesystems and symlink layers are rejected before acquiring leases.
Supplied `node_modules` declaration files are allowed; no dependency is inferred
from the author's workspace.

The native API receives a full `typescript/fs.createFileSystem`, not a layer or
`createFileSystemWithLib`. All eight native fallback operations are configured
with the pinned SDK's `serverFS.error`: reads, file/directory existence, directory
entries, realpath, stat, writes and removal. The SDK independently verifies the
exact callback specification before connecting. Native `runExternalCode` is
never enabled. This is compiler source authority, not an OS process sandbox;
the pinned SDK, native executable and application modules still load normally.

Root mode deliberately creates an explicit noLib/noEmit strict program.
Configured mode uses `createSnapshot.openProjects` over supplied tsconfig,
extends, reference and dependency contents. It does not pass through the
host-scoped introductory `readConfigFile`/`createProgram` example. Default
libraries are not implicitly mounted: callers must supply their required
libraries as ordinary admitted declarations. Missing libraries/dependencies
produce explicit compiler diagnostics. Every returned source and configuration
AST is checked against the original supplied text before projection.

## Structured answers and shared consumers

Answers retain symbols, full-span source-bound declarations, alias targets,
documentation/JSDoc, native types, overloads, parameters and return types.
Declaration coordinates explicitly mean UTF-16 full spans; no legacy
trivia-aware token-start API is assumed. Native type rendering is presentation,
not proof of exactness. Unsupported non-finite shared types remain `native-only`;
unresolved native error types are `unknown`.

Exact supported string literals, never, unions and finite template types lower
into the existing TypeIR arena and canonical serialization/decoder. Recursion,
union/template width, total node/depth, retained bytes and wire output are
bounded. Overflow fails the operation; it is never turned into a smaller exact
language. The new native receipt fixture also uses the normal symbolic artifact
writer, piece registry, checksum manifest, pinned graph store and public semantic
detail consumer, paired with the existing compiler's finite-string frontend.
No parallel semantic store or relaxed persisted format is introduced.

Each world identity binds original request contents, selected SDK/native
installation identities, producer version, private invocation namespace and
snapshot ID. Query/source/config hashes, program membership, declaration slices
and canonical graph identities are checked again in the parent. Raw SDK
objects never cross the request boundary. A foreign snapshot's type graph or a
changed producer result cannot be reused as this invocation's answer.

## Physical lifetime and bounds

The parent separately launches both children through the existing tracked
subprocess owner, with hidden Windows windows, zero retries and a25-second
whole-invocation deadline. The SDK uses its official socket transport through a
private nonce-named Windows pipe; its default spawn/package lookup is unused.
Backpressured relays cap native input at8MiB and output at16MiB. Worker result
transport is capped at8MiB, with a6MiB logical projection budget. The SDK's512MiB
V8 old-heap limit does not bound native RSS; the receipt says so explicitly.

Programs, the snapshot and API are disposed before the worker publishes its
result. The parent additionally requires actual SDK/native child-close events,
zero exits, complete output capture, no child stderr, and bridge closure.
API.close alone never releases a native installation. Both original managed
leases remain held through cancellation, transport failure, native failure and
metadata reconciliation. Failed closure retains the original recovery owner;
replacement receipts, elapsed time and a rejected promise are not close proof.
SDK timing dumps and inherited Node preload/search overrides are removed from
these owned child environments without changing the launching environment.

## Qualification and bridge retirement

Eleven inert contract/projection controls cover closed passive requests, source
ownership, project/path/query authority, exact shared consumers, aliases,
overloads/docs, unsupported types, budgets, source/snapshot identity,
configuration closure, altered receipts and the compiler capability inventory.
They do not claim vendor execution. Seven Windows vendor cases separately cover
real symbols/overloads, configuration/dependency closure, physical host-file
refusal, fresh snapshot isolation, cancellation after both children start,
invalid configuration and retained template parity. All are authored and locally
unrun in this implementation batch.

The Windows native-index CI job prepares the exact pair using
`node tools/ci/typescript-api7-qualification.js`, then runs only the seven native
cases serially, with30-second fixture deadlines, one indexing thread, zero
retries and native-status redo disabled. Preparation is a separate acquisition
step. The tests require the prepared pair and never substitute an inert SDK,
change the application compiler or skip a missing Windows installation.
Bounded receipts are uploaded under `.diagnostics/typescript-api7`.

The [capability inventory](typescript-api7-capabilities.json) records76 compiler
and AST call shapes across35 source owners, their callers and either a reviewed
SDK mapping or explicit unsupported state. A control detects call-set drift.
SDK export availability does not qualify the existing consumer. Structural slot
maps, trivia-aware starts, annotated symbolic lowering before checker expansion,
resolution caches/modes, complete reference graphs and embedded segment mapping
retain explicit unqualified entries.

Default promotion requires the actual beta qualification cases, paired existing
consumer coverage in each affected domain, complete admitted dependency/config/
library identity and lifetime/error/resource acceptance. Promotion to the stable
default additionally requires an approved stable release channel and matching
capability coverage; an experimental beta cannot override stable user-pinned
tooling. Each qualified domain must cut its bridge route over and remove its old
implementation and obsolete fixtures once replacement coverage is demonstrated.
The current profile does not advertise bridge retirement, whole-project parity,
all symbolic syntax, embedded mapping or a native memory limit. Those remaining
gates keep #1155 open.
