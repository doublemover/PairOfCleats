# Managed prebuilt C# package

The Windows x64/arm64 cache recipe for `csharp-ls` uses its official prebuilt
NuGet package through the existing managed archive owner. The selected stable
version is0.28.0, confirmed against the NuGet version index on2026-11-07.
The21,643,814-byte ZIP has224 entries and59,499,767 expanded file bytes. Its
SHA512 is
`a138b9c8f9de9dd6343e9b0d0c8f4d51637bba7e38606b7c2b08b1d91e8eefa39f12123057f6625f425812b4361e52841bd2856704ec127ff50144ce05170a99`.

Sources: [official package](https://www.nuget.org/packages/csharp-ls/0.28.0),
[publisher nuspec](https://api.nuget.org/v3-flatcontainer/csharp-ls/0.28.0/csharp-ls.nuspec)
and [pinned publisher program](https://github.com/razzmatazz/csharp-language-server/blob/72671fc7fa810c158864e72485db68e8b9b25c3d/src/CSharpLanguageServer/Program.fs).
The author-workspace package audit under `.tmp/tasks/csharp-package-closure/`
is historical source inspection, not a promised asset or execution receipt.

`DotnetToolSettings.xml` declares
`tools/net10.0/any/CSharpLanguageServer.dll` as the application. The archive
contains its prebuilt dependencies and MSBuild child host. Every one of the main
dependency manifest's193 declared runtime/native/resource assets had a matching
package file. The recipe retains the whole package, including localization,
runtime configuration, dependency manifests and notices; it does not copy only
the entry DLL. Native CLR, SDK and project resolution still require execution
qualification. Package availability alone cannot prove them usable.

Installation runs no NuGet resolution, `dotnet tool install`, restore, build or
generated launcher. Admission reserves the existing extractor's enforced1GiB
ceiling, the exact compressed archive and32MiB for bounded staging/receipts.
This is an enforced archive-owner bound, not a source-build estimate or measured
disk high-water. The existing checksum, destination, publication, repair/reuse,
original resource settlement and prior-generation preservation owners remain.

The canonical registry declares a compatible .NET10 SDK and runtime. Existing
compatible prerequisites can be reused; a missing supported Windows SDK uses
the existing separately admitted SDK recipe. The package's bounded version
probe runs its actual DLL through the already verified SDK host and rechecks
that host's original executable identity. Unexpected stderr prevents successful
verification. This proves CLI transport/version only, not LSP or MSBuild facts.

Runtime selection frames the exact selected DLL under `dotnet`. A managed SDK
uses its existing environment binding and generation lease. An explicitly
selected external SDK keeps its own host; it does not require or adopt an
unrelated managed SDK. A damaged selected package or SDK cannot silently fall
back to another generation. Original assembly paths and complete package
dependencies remain leased through child close and retained LSP sessions.

When the direct command and a declared runtime name the same physical generation,
one original retained handle serves both roles. The current selector and exact
expected tuple are still rechecked. The existing two complete byte inspections
run under that original lease; the identical alias does not repeat them or create
a second metadata lease. Copied handles, conflicting identities and duplicate
runtime declarations cannot grant this reuse. Three additional locally unrun
cases exercise actual inventory opens, one live lease, real framed child shutdown
and identity/lookalike refusal. This establishes intended work bounds; measured
SDK latency remains pending.

Both synchronous and asynchronous command probes preserve the DLL argument;
testing `dotnet --version` alone cannot qualify `csharp-ls`. The actual framed
host receives the existing repository-command trust check before execution.
Project loading retains the existing exact workspace-execution grant, bounded
transport, source mapping, cancellation and original retirement protocols.
Producer `lspBindings`70 rejects prior derived replay after this admission change.

Eight cases are authored and locally unrun. They cover canonical bounds,
original pending verification observations and warnings, real managed publication
and reuse, exact assembly/SDK framing, explicit external-host independence,
actual synchronous probes, untrusted-host non-execution, framed LSP initialize
and live generation retention through shutdown. Their explicitly selected inert
CLR/SDK protocol fixtures use real Node children and managed owners; they do not
establish native .NET execution. Vendor install, source facts, project/MSBuild
children and Windows storage high-water remain required. Other package/build
closures in #1559 and real-tool acceptance in #631 remain open.
