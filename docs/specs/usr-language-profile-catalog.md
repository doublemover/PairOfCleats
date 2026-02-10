# Spec -- USR Language Profile Catalog

Status: Draft v0.6
Last updated: 2026-02-10T08:15:00Z

## 0. Purpose and scope

This document defines the normative language profile schema and policy for USR.

It is a decomposition of `docs/specs/unified-syntax-representation.md` section 9 and related conformance sections.

Goals:

- map every registry language to explicit required normalized node/edge coverage
- declare baseline capability expectations (`supported|partial|unsupported`)
- define deterministic fallback behavior when preferred parsers are unavailable
- define minimum conformance levels and gating behavior by language

## 1. Canonical profile schema (normative)

```ts
type USRLanguageProfileV1 = {
  id: string; // registry language id
  parserPreference: "native" | "tree-sitter" | "hybrid" | "heuristic";
  languageVersionPolicy: {
    minVersion: string; // semantic or language-version label
    maxVersion: string | null; // null means open upper bound
    dialects: string[]; // canonical dialect identifiers
    featureFlags: string[]; // parser/compiler feature toggles expected by profile
  };
  embeddingPolicy: {
    canHostEmbedded: boolean;
    canBeEmbedded: boolean;
    embeddedLanguageAllowlist: string[]; // allowed embedded language IDs
  };
  requiredNodeKinds: string[]; // USRNormNodeKind values
  requiredEdgeKinds: string[]; // USREdgeKind values
  requiredCapabilities: Partial<{
    imports: "supported" | "partial" | "unsupported";
    relations: "supported" | "partial" | "unsupported";
    docmeta: "supported" | "partial" | "unsupported";
    ast: "supported" | "partial" | "unsupported";
    controlFlow: "supported" | "partial" | "unsupported";
    dataFlow: "supported" | "partial" | "unsupported";
    graphRelations: "supported" | "partial" | "unsupported";
    riskLocal: "supported" | "partial" | "unsupported";
    riskInterprocedural: "supported" | "partial" | "unsupported";
    symbolGraph: "supported" | "partial" | "unsupported";
  }>;
  fallbackChain: Array<"native-parser" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic">;
  frameworkProfiles: string[];
  requiredConformance: Array<"C0" | "C1" | "C2" | "C3" | "C4">;
  notes?: string;
};
```

Rules:

- `id` MUST be exact-match with language registry IDs.
- `languageVersionPolicy` MUST be present and MUST include non-empty `dialects` (use `["default"]` when no distinct dialects exist).
- `embeddingPolicy` MUST be present; `embeddedLanguageAllowlist` MUST be empty when `canHostEmbedded=false`.
- `requiredNodeKinds` and `requiredEdgeKinds` MUST be non-empty.
- `fallbackChain` MUST be deterministic and MUST NOT repeat identical adjacent stages.
- `requiredConformance` MUST contain `C0` and `C1` for all languages.
- `C4` MUST only appear when framework overlays are applicable.

## 2. Capability classes (normative policy)

Language profiles MUST classify capabilities consistently.

| Capability class | Required state policy | Allowed downgrade target |
| --- | --- | --- |
| structural baseline (`docmeta`, `ast`, `symbolGraph`) | MUST be `supported` for parser-backed languages unless explicitly exempted by profile | `partial` only with diagnostics |
| relation baseline (`imports`, `relations`, `graphRelations`) | MUST be `supported` where language has import/reference semantics | `partial` with reason code |
| flow surfaces (`controlFlow`, `dataFlow`) | MUST explicitly declare `supported|partial|unsupported`; DSL/template/markup languages commonly use `partial` | `unsupported` with explicit diagnostics |
| risk surfaces (`riskLocal`, `riskInterprocedural`) | language-dependent; MUST be explicit | `partial` or `unsupported` per profile |

## 3. Registry language profile matrix (normative baseline)

The table below is the mandatory baseline for every registry language.

| Language ID | Parser preference | Required conformance | Framework profiles |
| --- | --- | --- | --- |
| `javascript` | `hybrid` | `C0,C1,C2,C3,C4` | `react,next` |
| `typescript` | `hybrid` | `C0,C1,C2,C3,C4` | `react,next,angular` |
| `python` | `hybrid` | `C0,C1,C2,C3` | none |
| `clike` | `hybrid` | `C0,C1,C2,C3` | none |
| `go` | `hybrid` | `C0,C1,C2,C3` | none |
| `java` | `hybrid` | `C0,C1,C2,C3` | none |
| `csharp` | `hybrid` | `C0,C1,C2,C3` | none |
| `kotlin` | `hybrid` | `C0,C1,C2,C3` | none |
| `ruby` | `tree-sitter` | `C0,C1,C2,C3` | none |
| `php` | `tree-sitter` | `C0,C1,C2,C3` | none |
| `html` | `tree-sitter` | `C0,C1,C4` | `vue,nuxt,svelte,sveltekit,angular,astro` |
| `css` | `tree-sitter` | `C0,C1,C4` | `vue,nuxt,svelte,sveltekit,angular,astro,react,next` |
| `lua` | `tree-sitter` | `C0,C1,C2,C3` | none |
| `sql` | `hybrid` | `C0,C1,C2,C3` | none |
| `perl` | `heuristic` | `C0,C1,C2,C3` | none |
| `shell` | `hybrid` | `C0,C1,C2,C3` | none |
| `rust` | `hybrid` | `C0,C1,C2,C3` | none |
| `swift` | `hybrid` | `C0,C1,C2,C3` | none |
| `cmake` | `tree-sitter` | `C0,C1,C2` | none |
| `starlark` | `tree-sitter` | `C0,C1,C2` | none |
| `nix` | `tree-sitter` | `C0,C1,C2` | none |
| `dart` | `hybrid` | `C0,C1,C2,C3` | none |
| `scala` | `tree-sitter` | `C0,C1,C2,C3` | none |
| `groovy` | `tree-sitter` | `C0,C1,C2,C3` | none |
| `r` | `tree-sitter` | `C0,C1,C2,C3` | none |
| `julia` | `tree-sitter` | `C0,C1,C2,C3` | none |
| `handlebars` | `tree-sitter` | `C0,C1,C4` | none |
| `mustache` | `heuristic` | `C0,C1,C4` | none |
| `jinja` | `tree-sitter` | `C0,C1,C4` | none |
| `razor` | `hybrid` | `C0,C1,C4` | none |
| `proto` | `tree-sitter` | `C0,C1,C2` | none |
| `makefile` | `tree-sitter` | `C0,C1,C2` | none |
| `dockerfile` | `tree-sitter` | `C0,C1,C2` | none |
| `graphql` | `tree-sitter` | `C0,C1,C2` | none |

### 3.1 Version and embedding policy classes (normative baseline)

Language profiles MUST classify version and embedding policy into one of the classes below and encode exact values in:

- `usr-language-version-policy.json`
- `usr-language-embedding-policy.json`

| Policy class | Applies to | Required baseline |
| --- | --- | --- |
| `VM-typed-script` | `javascript,typescript` | explicit runtime/ecma or compiler version baseline; host and embedded both enabled |
| `VM-managed` | `java,csharp,kotlin,scala,groovy,dart` | explicit compiler/runtime baseline; embedded disabled unless profile explicitly opts in |
| `Native-systems` | `clike,go,rust,swift` | explicit toolchain baseline; host and embedded disabled |
| `Dynamic-runtime` | `python,ruby,php,lua,perl,shell,r,julia` | explicit runtime baseline; embedding policy explicit per language |
| `Markup-template` | `html,handlebars,mustache,jinja,razor` | explicit template/markup baseline; host enabled with allowlist |
| `Style` | `css` | explicit css baseline; embedded enabled, host disabled |
| `Data-interface` | `sql,proto,graphql` | explicit spec version baseline; embedded explicit per language |
| `Build-dsl` | `cmake,starlark,nix,makefile,dockerfile` | explicit tool/dialect baseline; host and embedded disabled |

## 4. Required node/edge minimums by language family

This section defines non-exhaustive, mandatory minimums used to populate `requiredNodeKinds` and `requiredEdgeKinds`.

| Family | Required node kinds (minimum) | Required edge kinds (minimum) |
| --- | --- | --- |
| JS/TS-like | `module_decl,function_decl,class_decl,import_stmt,export_stmt,call_expr` | `imports,exports,defines,references,calls,uses_type` |
| Systems OO (`clike,go,rust,swift`) | `module_decl,function_decl,type_alias_decl,variable_decl,call_expr` | `imports,defines,references,calls,extends|implements (where applicable)` |
| Managed OO (`java,csharp,kotlin,scala,groovy,dart`) | `class_decl,interface_decl,method_decl,field_decl,param_decl` | `imports,defines,references,calls,extends,implements,uses_type` |
| Dynamic script (`python,ruby,php,lua,perl,shell,r,julia`) | `function_decl,variable_decl,call_expr,control_stmt` | `imports|contains,defines,references,calls` |
| Markup/style/template (`html,css,handlebars,mustache,jinja,razor`) | `template_element,html_element,css_rule,directive_expr` | `contains,template_binds,template_emits,style_scopes` |
| Data/interface DSL (`sql,proto,graphql`) | `sql_stmt,graphql_type_decl,interface_decl,type_alias_decl` | `contains,references,uses_type` |
| Build DSL (`cmake,starlark,nix,makefile,dockerfile`) | `build_stmt,variable_decl,call_expr` | `contains,references,calls` |

## 5. Fallback behavior contract

Each language profile MUST define deterministic fallback handling:

1. execute parser selection via profile `parserPreference`
2. if unavailable/failed, execute `fallbackChain` in order
3. emit diagnostics from USR section 33 for each degradation stage
4. update capability states with required transitions
5. preserve successfully emitted prior-stage entities

Additional rules:

- if fallback reaches `heuristic`, profile MUST set `ast` to `partial` or `unsupported`
- fallback MUST NOT silently promote confidence to 1.0
- unresolved symbol/reference outcomes MUST include resolution envelope reason codes

## 6. Required artifacts and files

Implementations MUST maintain:

- `tests/lang/matrix/usr-language-profiles.json` (authoritative machine-readable catalog)
- `tests/lang/matrix/usr-language-version-policy.json` (language version and dialect policy matrix)
- `tests/lang/matrix/usr-language-embedding-policy.json` (language embedding policy matrix)
- `tests/lang/matrix/usr-parser-runtime-lock.json` (parser/runtime lock coverage for language parser sources)
- `tests/lang/matrix/usr-generated-provenance-cases.json` (language provenance coverage matrix)
- `docs/specs/usr/languages/<language-id>.md` for each registry language

Drift checks MUST ensure exact set equality between language registry IDs and catalog entries.

## 7. Change-control requirements

Language profile changes are contract changes:

- Additive changes (new optional nodes/edges) are Tier 2
- Required capability/conformance changes are Tier 3
- Any parser preference downgrade MUST include migration note and conformance impact statement

## 8. Per-language child contract requirements

Every file in `docs/specs/usr/languages/<language-id>.md` MUST define:

- explicit required node-kind set for that language
- explicit required edge-kind set for that language
- explicit capability baseline map
- parser fallback sequence and downgrade behavior
- language-specific edge-case fixture families
- language-specific risk taxonomy expectations (when C3 applies)

Child contracts MUST NOT conflict with this catalog. Conflicts are Tier 3 blockers.

## 9. Machine-readable validation contract

`tests/lang/matrix/usr-language-profiles.json` MUST validate the following additional constraints:

- `id` values are unique and lexically sorted
- `frameworkProfiles` entries are unique and sorted
- `requiredConformance` entries are unique and sorted in canonical order (`C0,C1,C2,C3,C4`)
- `fallbackChain` starts with the preferred parser strategy or a justified equivalent
- `languageVersionPolicy.minVersion` and `languageVersionPolicy.dialects` are non-empty
- `embeddingPolicy.embeddedLanguageAllowlist` values are valid registry language IDs
- every language ID in the registry has exactly one row
- every language ID in the registry has exactly one row in both version and embedding policy matrices
- every parser source used by a language profile (`parserPreference` + `fallbackChain`) is covered by at least one matching row in `usr-parser-runtime-lock.json`

Required report outputs:

- `usr-language-profile-coverage.json`
- `usr-language-profile-drift.json`
- `usr-language-profile-capability-gaps.json`
- `usr-language-version-policy-drift.json`
- `usr-language-embedding-policy-drift.json`

## 10. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/specs/usr-registry-schema-contract.md`


