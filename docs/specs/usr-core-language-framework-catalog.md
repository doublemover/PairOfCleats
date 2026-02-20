# Spec -- USR Core Language and Framework Catalog Contract

Status: Draft v2.0
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define consolidated language and framework profile obligations, including capability states, fallback behavior, and edge-case canonicalization requirements.

## Consolidated source coverage

This contract absorbs:

- `usr-language-profile-catalog.md` (legacy)
- `usr-framework-profile-catalog.md` (legacy)
- `usr-language-feature-coverage-contract.md` (legacy)
- `usr-framework-interactions.md` (legacy)
- `usr-framework-macro-transform-contract.md` (legacy)
- `usr-embedded-language-matrix.md` (legacy)
- all legacy per-language and per-framework profile files under `docs/specs/usr/languages/*.md` and `docs/specs/usr/frameworks/*.md`

## Required profile artifacts

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-framework-profiles.json`
- `tests/lang/matrix/usr-capability-matrix.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`
- `tests/lang/matrix/usr-framework-edge-cases.json`

## Language profile schema

Each language row must define:

- `languageId`
- parser preference (`native`, `tree-sitter`, `hybrid`, `heuristic`)
- required normalized node kinds
- required edge kinds
- capability states (`supported`, `partial`, `unsupported`)
- fallback behavior and required diagnostics
- conformance target class (`C0`..`C4`)

Required machine-readable row keys:

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `languageId` | string | yes | Must match registry ID exactly. |
| `parsers` | array | yes | Ordered by precedence; each entry includes parser ID and version policy. |
| `requiredNodeKinds` | array | yes | Canonical normalized node kinds only. |
| `requiredEdgeKinds` | array | yes | Canonical edge kinds only. |
| `capabilities` | object | yes | Capability state per dimension. |
| `fallbackPolicy` | object | yes | Degradation behavior, diagnostics, and fail-open/closed policy. |
| `conformanceTarget` | string | yes | `C0`..`C4`. |
| `riskProfile` | object | conditional | Required if C3 or higher. |

## Language batches (authoritative)

| Batch | Language IDs | Minimum conformance target |
| --- | --- | --- |
| A -- JS/TS and web templates | `javascript`, `typescript`, `html`, `css`, `graphql`, `handlebars`, `mustache`, `jinja`, `razor` | C4 for JS/TS + framework overlays, C2/C3 for template languages as applicable |
| B -- core systems/runtime | `python`, `go`, `java`, `csharp`, `kotlin`, `rust`, `swift`, `clike` | C3 |
| C -- dynamic/server scripting | `ruby`, `php`, `perl`, `lua`, `shell`, `r`, `julia`, `groovy`, `scala`, `dart` | C2/C3 |
| D -- build/config/data DSLs | `cmake`, `starlark`, `nix`, `makefile`, `dockerfile`, `proto`, `sql`, `yaml`, `json`, `toml`, `ini`, `xml` | C1/C2 |

## Framework profile coverage

Required framework profiles:

- `react`
- `vue`
- `next`
- `nuxt`
- `svelte`
- `sveltekit`
- `angular`
- `astro`

Each framework row must define:

- detection precedence and tie-break rules
- segmentation rules across script/template/style/frontmatter blocks
- route canonicalization behavior
- template binding canonicalization behavior
- style scope canonicalization behavior
- SSR/CSR/hydration/island boundary behavior
- fallback diagnostics for unsupported constructs

Required machine-readable row keys:

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `frameworkProfile` | string | yes | Canonical profile ID. |
| `detectionPrecedence` | array | yes | Ordered detector list and tie-break policy. |
| `segmentationRules` | object | yes | Script/template/style/frontmatter split policy. |
| `routeSemantics` | object | yes | Route extraction + canonicalization policy. |
| `templateBindingSemantics` | object | yes | Binding extraction and canonical edge attrs. |
| `styleSemantics` | object | yes | Scope policy and edge attrs. |
| `runtimeBoundarySemantics` | object | yes | SSR/CSR/hydration/island rules. |
| `unsupportedBehavior` | object | yes | Diagnostic and fallback policy. |

## Framework canonicalization requirements

### Routes

- canonical `routePattern` uses bracket form (`[id]`, `[...slug]`)
- origin syntax (`:id`, wildcard, regex) must be preserved in attrs metadata
- unresolved route targets must emit deterministic reason codes

### Template bindings

- bindings canonicalize to `template_binds` edges
- framework-native syntax is preserved in attrs (`directive`, `eventSyntax`, `bindingKind`)
- source-to-symbol trace must be maintained for slot/prop/store/composable patterns

### Style scopes

- canonical scope types: `global`, `module`, `scoped`, `shadow`, `unknown`
- framework-specific scoping tokens are preserved in attrs
- style ownership edges must exist when component ownership is determinable

## Mandatory framework edge-case coverage

| Framework | Required edge-case families |
| --- | --- |
| `react` | nested routers, lazy routes, prop spread bindings, CSS modules, CSS-in-JS |
| `vue` | named routes and aliases, `v-model` variants, slot-prop forwarding, scoped/deep selectors |
| `next` | app router groups, parallel routes, server/client boundary props, module/global css interactions |
| `nuxt` | file-system conflicts, route rules overlays, composable bindings, scoped style interactions |
| `svelte` | bind directives, store auto-subscriptions, compiled scoped selectors, global escapes |
| `sveltekit` | `+layout`/`+page` precedence, load-data propagation, form actions, scoped style across layouts |
| `angular` | nested route modules, structural directives, template binding forms, encapsulation modes |
| `astro` | static/dynamic/rest routes, frontmatter-template bridges, island boundaries, scoped/global style behavior |

## Embedded-language policy

Embedded segments (`.vue`, `.svelte`, `.astro`, Angular template/style splits, SQL in strings, GraphQL literals, etc.) must define:

- container language
- effective segment language
- parser source
- bridge requirements between segments
- fallback diagnostics for partial extraction

Mandatory bridge fields for embedded segments:

| Field | Required | Description |
| --- | --- | --- |
| `bridgeId` | yes | Unique bridge scenario ID. |
| `containerLanguageId` | yes | Physical file language. |
| `embeddedLanguageId` | yes | Segment effective language. |
| `entryEdgeKinds` | yes | Required edge kinds entering embedded segment. |
| `exitEdgeKinds` | yes | Required edge kinds leaving embedded segment. |
| `lossModes` | yes | Enumerated fidelity-loss classes. |
| `fallbackReasonCodes` | yes | Deterministic diagnostics for unsupported bridge cases. |

## Capability-state obligations

A profile marked `supported` must provide deterministic output with required entities and edges.

A profile marked `partial` must provide explicit missing-surface diagnostics.

A profile marked `unsupported` must fail gracefully with deterministic diagnostics and no silent drops.

Capability-state compliance rules:

1. `supported` requires all mandatory entities and edge families for the declared profile scope.
2. `partial` requires explicit missing-surface diagnostics and fallback semantics.
3. `unsupported` requires deterministic diagnostic-only behavior with zero guessed semantic edges.
4. state transitions (`unsupported` -> `partial` -> `supported`) require conformance evidence updates.

## Required outputs

- `usr-language-profile-coverage.json`
- `usr-framework-profile-coverage.json`
- `usr-framework-edge-case-coverage.json`
- `usr-embedded-language-coverage.json`

## Acceptance criteria

This contract is considered green only when:

1. every registry language has a complete profile row with no missing required keys
2. every required framework profile has complete route/template/style/runtime semantics rows
3. framework edge-case coverage is complete for all mandatory families
4. embedded-language bridge rows validate and corresponding fixtures pass target conformance levels

## References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-quality-conformance-testing.md`

