# Understand language capabilities

Use this guide to choose evidence, then consult the current
[language registry](../../src/index/language-registry/registry-data.js),
[native grammar registry](../../src/lang/tree-sitter/native-runtime.js),
[provider owners](../../src/index/tooling/providers/index.js) and
[USR capability matrix](../../tests/lang/matrix/usr-capability-matrix.json).
These owners identify particular routes; a language name alone is not a claim of
full AST or whole-project semantic completeness.

| Route | What it establishes | Required evidence and limits |
| --- | --- | --- |
| Extension/special-file admission | A file is routed to a supported handler | Registry/descriptor tests; does not imply successful parsing |
| Native grammar activation | The selected native parser accepts a tiny sample | Package/version, Node ABI and platform receipt; indexing has no WASM fallback |
| Syntax/chunks and simple relations | Bounded source chunks and available import/relation extraction | Language fixtures and omission diagnostics; syntax is distinct from compiler facts |
| Structured compiler facts | A dedicated provider supplies supported types/symbol facts | Exact compiler/profile, trusted source/build context and consumer tests |
| Generic LSP enrichment | A selected server initializes and provides its advertised capabilities | Exact executable/runtime, protocol handshake, source mapping and bounded project fixture |
| Project/framework integration | Facts are grounded in the selected project/build environment | Supported/partial/unsupported declaration, toolchain and source identity, cross-file consumer evidence |

Inference is enabled unless `indexing.typeInference` is explicitly false in the
current runtime. The [conservative first-search profile](first-search.md) turns
it off deliberately. Repo-local TypeScript resolution is used only when the
repository is trusted; compiler compatibility/source identity and parsing fallback
are separate decisions. Tool detection or installation cannot establish them.

Use [setup planning](setup.md) for chosen prerequisites and
[effective configuration](configuration.md) for trust-discarded commands/settings.
No tool install, grammar upgrade or language issue proposal automatically promotes
coverage. Qualify each changed route on an exact head/runtime/platform/date and
state unsupported or partial results directly.

Contributors follow [one onboarding journey](usr-new-language-onboarding.md).
[Dated toolchain acceptance](language-toolchain-acceptance.md) retains historical
Node24/Node26 trials and failures; it is not the current capability reference or
universal platform qualification. New integration source in this development
batch remains **UNVALIDATED** until its own declared tests/consumer proofs run.
