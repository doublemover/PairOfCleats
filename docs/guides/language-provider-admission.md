# Language provider admission and retained presentation

Kotlin's explicit `kotlin-lsp` profile uses the shared configured LSP runtime.
The existing Kotlin source route produces chunks and targets before provider
selection; the provider cannot introduce syntax partitions. Script `.kts`
documents remain excluded. Repository trust is required before Gradle or Maven
import can execute. Nested module roots use the existing workspace router.

Kotlin function presentation now has a language-specific adapter. It preserves
the complete observed signature and explicit parameter/return text, including
nullable/generic/function types, extension receivers, suspend modifiers and
constraints. The legacy parameter/return projection does not represent receiver
bindings or overload selection. Omitted return types stay unknown; no `Unit` or
compiler TypeIR is inferred. Annotated parameters, function-type receivers and
unparenthesized generic-call defaults remain unsupported rather than guessed.

The deterministic Kotlin fixture uses ordinary file classification, Kotlin
chunking, virtual-document preparation, configured-provider selection and
`runToolingPass` to assert retained `docmeta` and inferred presentation. It uses
an explicitly selected protocol fixture. This is not an official Kotlin server,
Gradle import, Android/Multiplatform or durable compiler-binding qualification.
The official server remains Alpha and its bundle/runtime licensing and actual
platform capability identity need separate admission.

Dart preflight checks the nearest `pubspec.yaml` roots for selected documents,
including nested packages. Its bounded package-config reader validates v2 names,
URI roots/package directories, language versions, duplicate roots and nested
ownership. URI escapes are interpreted at the native file-URI boundary. Missing,
invalid, oversized, unreadable and unresolved package models remain distinct
diagnostics. Local unavailable roots degrade presentation; remote roots block
server execution in this offline profile. Preflight never runs `pub get`, Flutter
builds, dependency installation or network requests.

External local package roots are recorded as unobserved without reading them.
The observed package-config digest is a model observation, not proof that all
dependencies or generated sources are fresh. Dart now requires a complete
host-observed provider profile before durable provider-cache reuse; incomplete
closure uses a live run. The same observation requirement applies to configured
LSP profiles, dedicated adapters, Pyright, clangd and SourceKit. Tool installation
or unchanged source text alone cannot establish their dependency closure.
The analyzer sidecar, Flutter/workspace SDK pairing and
resolved compiler-fact consumers in #1174 remain separate unfinished scope.

Shared provider preflight cancellation is terminal even for optional preflight.
Deadlines may report promptly while the original operation drains; its slot,
single-flight entry and process ownership survive until settlement. An optional
timeout blocks launch while teardown is unresolved. Dedicated-provider setup
cleanup runs on skipped launch and cancellation, and JDT runtime-lock acquisition
receives the same effective cancellation signal as the provider.

Command denial and pending managed-command settlement block admission. They are
distinct from a missing executable or an inconclusive version probe. A denied
runtime prerequisite stops custom project preparation and server launch. Cached
provider output and late live output observe the same composed request/context
cancellation signal as preflight, including profile verification and result
admission. These controls do not cancel or discard already owned child teardown.

Primary references: [Kotlin function syntax](https://kotlinlang.org/spec/declarations.html#function-declaration),
[official Kotlin LSP](https://github.com/Kotlin/kotlin-lsp),
[Dart package-config v2 specification](https://github.com/dart-lang/language/blob/main/accepted/2.8/language-versioning/package-config-file-v2.md).
