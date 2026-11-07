# Portable managed .NET prerequisites

The canonical `dotnet-sdk` tooling profile contains the Microsoft SDK 10.0.402
and Core runtime 10.0.13 for native Windows x64, ia32 and arm64. Its portable ZIP
recipes use the official .NET release metadata SHA512, exact Azure Blob URL and
observed content length. Source metadata and HEAD lengths were read on
2026-10-23; archives were not downloaded or executed for this implementation.

Explicit cache installation and lifecycle apply may prepare that SDK when a
selected tool needs missing, compatible .NET prerequisites. Planning reports the
exact action and descriptor without executing it. Existing incompatible versions,
explicit `DOTNET_ROOT`/command selections, rejected command trust and damaged
managed generations keep their blockers. A requirement outside SDK 10.0.402/Core
runtime 10.0.13 or beyond its declared Core component coverage receives no
incompatible substitute. Cache scope never installs a system package or changes
machine PATH, registry, security policy or Windows features.

The native verifier checks `--list-sdks`, `--list-runtimes` and `--info` under the
exact staged or retained SDK root, with a canonical managed child cache/scratch
session. Wrong SDK/runtime packs, foreign roots, host architecture/RID or missing
native dependencies reject publication. The original 1 GiB archive/inventory,
128 MiB individual file and 50,000-entry limits are retained. The complete pinned
vendor archive still needs host qualification against those limits; a bound
failure remains a failure and does not permit an external extractor.

Selected managed prerequisite generations carry descriptor/install identities
into verification, installer, detector and operational execution. Their existing
physical generation leases stay held through actual children. Pending resources
expose in-process recovery capabilities requiring original closure observers;
serialized plans and a caller's `settled: true` claim cannot replace that evidence.
Managed .NET environment binding removes ambient architecture/resolver overrides
and points the child at its selected host. Provider apphost/LSP execution must use
the corresponding managed runtime command lifetime owner as well.

This is prerequisite support, not C#/Roslyn language readiness. Real Windows
archive extraction, native DLL dependency/OS support, host target, server
initialization and a reviewed workspace request remain unqualified. The authored
SDK verification and actual-consumer fixtures are UNRUN in this parallel wave.

Portable JDK/Python/Ruby/PHP environments, transitive pinned npm/gem/NuGet closure,
and a pinned Windows Semgrep virtual environment remain unsupported where their
complete immutable recipe and prerequisites are absent. No capability is inferred
from an executable name, a partial package or an inactive helper.
