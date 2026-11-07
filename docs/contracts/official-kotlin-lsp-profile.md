# Explicit official Kotlin LSP profile

Status: **UNVALIDATED partial integration** for #1168. No server, fixture,
workspace, parser, formatter, syntax check or gate ran for this source release.

The existing configured-provider path accepts `preset: "kotlin-official"`
(canonical profile `kotlin-lsp`). It selects the official CLI's `--stdio` route
and admits existing `.kt` tooling documents. It stays excluded from automatic
detection enablement. Users can supply the exact admitted standalone launcher
through the existing `cmd`/`args` fields; this implementation creates no PATH
symlink and does not silently install or select another product. Compiler and
executable versions are distinct from the adapter/profile contract identity.

Gradle/Maven workspace markers feed the existing workspace routing/preflight
owner. Exact repository trust is required before a command probe, server launch
or workspace import, including when a configured profile renames its ID and
command. The normalized canonical execution-profile identity cannot be removed
by those aliases. This also preserves the selected Ruby LSP trust requirement
when its command and ID are renamed. Kotlin scripts (`.kts`) stay outside this
initial source route. A suffix/build marker does not qualify a JVM source set,
Android, Multiplatform, Gradle/Maven import or mixed-language build target.

Retired `kotlin-language-server` / fwcd selections return
`kotlin_fwcd_migration_required` before probing or launching. They never silently
start the official server or remain an executable compatibility route. The
official server remains Alpha and partially closed-source, as described by the
[upstream project](https://github.com/Kotlin/kotlin-lsp). Its
[stdio integration contract](https://github.com/Kotlin/kotlin-lsp/blob/main/scripts/neovim.md)
supplies the launch flag. A repository license does not establish distribution
rights or the selected bundle's runtime/license identity.

The profile reaches existing generic LSP transport, capability negotiation,
legacy chunk enrichment and diagnostic projection, and the shared managed
installation lifetime owner when a managed command is selected. Existing
`.kt` discovery and chunks remain the admission route. A handshake or emitted
hover string does not establish structured types or durable graph coverage.
The #1146 observed-profile policy keeps incomplete closure unqualified.

`tooling/providers/explicit-official-kotlin-profile` is an authored, unrun
existing-language-route/selection/negative-flow regression for opt-in selection,
renamed execution authority, script exclusion, disabled execution, fwcd migration
and Ruby alias authority. It does not execute a server. Exact supported platform
archives, integrity/license/runtime admission, a maintained provisioning recipe,
wrong-product/version rejection, full provider declarations with enforced whole
pass budgets, nested source-set/BSP target identities, structured/native semantic
source admission, actual tiny JVM consumer examples and publication receipts
remain pending. No current release pin is guessed or promoted by this subset.
