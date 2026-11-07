# Native TypeScript LSP

The explicit `typescript-native` preset selects the stable TypeScript7.0.2 native
server, separately from the existing TypeScript6 programmatic compiler API.
It uses `tsc.exe --lsp --stdio`, as supplied by the official platform package.
It does not run the npm wrapper, compile Go or replace the compiler API package.
The default command resolves only a canonical managed generation; it cannot
select an ambient TypeScript6 `tsc`, `tsserver` or `typescript-language-server`.
An explicit external command retains the normal executable/project trust checks.
Every new or reused session must identify itself as `typescript-go`7.0.2 before
source requests are admitted. Tool, adapter and protocol identities remain distinct.

`tooling.lsp.servers: [{ "preset": "typescript-native" }]` uses the existing
explicit server configuration. It is excluded from automatic preset discovery
and automatic language-tool installation until real native qualification.
An existing `enabledTools` selection can explicitly request its managed install.
Plain JS/JSX/TS/TSX and module suffixes are admitted; embedded Vue/Svelte/MDX
documents need their own qualified source adapter. Existing project-execution
authority applies before launching this profile. The existing exclusive-provider
selection retires the older semantic provider for this explicit native choice;
there is no silent fallback when native admission fails.

Automatic typing acquisition is disabled through the release's actual
`userPreferences.automaticTypeAcquisitionEnabled` and
`js/ts.tsserver.automaticTypeAcquisition.enabled` configuration contracts.
Telemetry and push diagnostics are disabled. These defaults come from the
reviewed server's initialization and user-preference schemas, rather than an
unrecognized initialization flag. Explicit configured settings remain part of
the existing trusted project/profile identity.

## Managed acquisition

Windows x64 and arm64 have separate immutable official platform packages.
The archive owner verifies exact bytes/SHA512, extracts the complete package,
checks its native entry/standard library/license layout and publishes through
the existing generation, storage-admission, verification and lease owners.
Both archives contain113 files, no runtime dependencies and no lifecycle scripts:

| Target | Archive bytes | Expanded ordinary-file bytes |
| --- | ---: | ---: |
| Windows x64 | 9,776,626 | 28,365,027 |
| Windows arm64 | 8,900,840 | 26,801,387 |

The inclusive reservation uses the existing extractor's enforced1GiB ceiling,
exact archive bytes and32MiB bounded metadata allowance. This is an enforced
archive bound, not a measured native filesystem high-water or build forecast.
CLI verification checks the selected `Version 7.0.2` output with original
per-field result/resource observations and cancellation. Its receipt claims
native CLI version verification, not protocol or semantic consumer acceptance.
Other platforms and32-bit Windows have no new managed recipe in this batch.

Reviewed sources: [stable release](https://github.com/microsoft/typescript-go/releases/tag/typescript%2Fv7.0.2),
[official migration/API distinction](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/),
[x64 metadata](https://registry.npmjs.org/%40typescript%2Ftypescript-win32-x64/7.0.2),
[arm64 metadata](https://registry.npmjs.org/%40typescript%2Ftypescript-win32-arm64/7.0.2),
[pinned stdio launch](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/cmd/tsgo/lsp.go),
[initialization schema](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/lsp/lsproto/lsp_generated.go),
[acquisition preferences](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/ls/lsutil/userpreferences.go).

## Pull diagnostics

The shared LSP collector advertises non-dynamic document diagnostics and refresh
support when diagnostics are requested. It pulls only original currently open
document URIs, with their exact versions, through the existing request guard.
An advertised pull provider uses this path; other servers retain their bounded
push-notification drain. Reports pass through the same owned-URI collector,
diagnostic caps and exact source-range/chunk projection.

One collection admits at most10,000 documents and a four-second shared budget,
further limited by its existing soft deadline. Each request receives only the
remaining time, including descriptor-pressure backoff. Its guard narrows request
retries to zero; it cannot expand the configured policy. Ownership checks use original map identity with constant-time
lookups. Retirement/replacement/version changes reject the response. There is
no result-ID cache: `unchanged` without a retained original answer is incomplete.
Unrequested related documents never become source authority. Refresh invalidates
the current reports and admits at most one fresh pass under the same budget;
further refresh, bounds, malformed reports or ordinary request failure remain
explicit incomplete diagnostics. Pending original resource failures propagate
instead of becoming an ordinary diagnostic warning. Semantic producer
`lspBindings`69 invalidates replay of the earlier collection meaning.

Four managed/profile controls and six pull controls are authored and locally
unrun. Their inert publication fixture and actual framed Node server test strict
identity, source/URI authority, settings, refresh, diagnostic mapping, document
close and shutdown. They do not qualify vendor/native execution. Real Windows
installation, initialize/semantic requests, project compatibility, warm/cold
identity, cancellation and high-water acceptance remain to run. TS7.1 structured
API migration remains a separate adapter task (#1155); this does not manufacture
compiler API answers from hover strings. #1154/#1559 remain open pending their
complete original and follow-up acceptance.

The archive/source inspection under author-workspace `.tmp/tasks/typescript7-closure/`
is historical read-only input evidence, not an asset promised in clean checkouts.
