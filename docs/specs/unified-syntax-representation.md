# Spec -- Unified Syntax Representation (USR)

Status: Draft v0.7
Last updated: 2026-02-10T07:40:00Z

Applies to: PairOfCleats indexing pipeline, language registry, framework segmentation/extraction, graph/risk/query surfaces.

Primary goal: define a single canonical representation for source syntax and semantics that is deterministic, language-complete, framework-aware, and conformance-testable.

## 0. Purpose and Scope

This spec defines the canonical Unified Syntax Representation (USR) for all supported languages and framework profiles.

USR is the normalized substrate used to:

- unify parsing outputs from native parsers, tree-sitter, and framework compilers
- standardize symbol/AST/relation/flow/risk inputs across languages
- support deterministic graph/query/risk downstream artifacts
- ensure full, explicit support contracts for all language IDs in `src/index/language-registry/registry-data.js`

This spec is normative for representation semantics and deterministic behavior.

This spec does not replace artifact IO and storage mechanics. Those remain governed by:

- `docs/contracts/public-artifact-surface.md`
- `docs/contracts/artifact-schemas.md`
- `docs/specs/artifact-io-pipeline.md`

## 1. Normative Language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as normative requirements.

## 2. Relationship to Existing Contracts

USR is layered on top of existing contracts.

- Existing `metaV2` semantics remain valid (`docs/specs/metadata-schema-v2.md`).
- Existing identity contracts remain authoritative for segment and chunk identity (`docs/specs/identity-contract.md`).
- Existing symbol identity and reference contracts remain authoritative (`docs/specs/identity-and-symbol-contracts.md`).
- Existing artifact schemas remain canonical for persisted artifacts.

USR introduces a canonical in-memory and persisted representation model that can be mapped to existing artifacts without breaking those contracts.

### 2.1 Decomposed contract precedence and alignment

USR is decomposed into focused contracts under:

- `docs/specs/usr/README.md`
- `docs/specs/usr-*.md`
- `docs/specs/usr/languages/*.md`

Precedence:

1. this umbrella USR spec
2. decomposed contracts and per-language contracts
3. implementation/roadmap task documents

If decomposed contracts diverge from umbrella requirements, the umbrella spec is authoritative and divergence is a release-blocking contract drift issue.

## 3. Supported Coverage

### 3.1 Registry Language IDs (Authoritative)

The following language IDs are REQUIRED coverage targets:

`javascript`, `typescript`, `python`, `clike`, `go`, `java`, `csharp`, `kotlin`, `ruby`, `php`, `html`, `css`, `lua`, `sql`, `perl`, `shell`, `rust`, `swift`, `cmake`, `starlark`, `nix`, `dart`, `scala`, `groovy`, `r`, `julia`, `handlebars`, `mustache`, `jinja`, `razor`, `proto`, `makefile`, `dockerfile`, `graphql`

### 3.2 Framework Profiles (Required)

USR framework profiles are first-class overlays and MUST be supported where applicable:

- React
- Vue 3
- Next.js
- Nuxt 3
- Svelte/SvelteKit
- Angular
- Astro

## 4. Core Invariants

USR outputs MUST satisfy all of the following invariants.

- Deterministic ordering for all arrays and maps serialized as arrays.
- Stable identity generation for document, segment, node, symbol, and edge IDs for identical inputs.
- Explicit partial-support signaling for unavailable capabilities.
- Explicit presence/absence behavior per language profile.
- Preservation of both container-file coordinates and segment/virtual coordinates.
- Retention of raw parser/compiler node kinds in addition to normalized kinds.

## 5. Coordinate and Text Model

### 5.1 Encodings and offsets

USR uses decoded text and UTF-16 code unit offsets for canonical ranges.

- `start` and `end` offsets are UTF-16 code unit indices.
- `line` values are 1-based.
- `column` values are 1-based UTF-16 columns.

### 5.2 Dual coordinate spaces

Every range-bearing USR entity MUST carry:

- container-space range: positions in the physical container file
- virtual-space range: positions in the effective segment document

### 5.3 Normalization function

All identity and hash inputs that depend on text MUST use the same newline normalization used by identity contracts.

`normalizeForUid(text)`:

1. `\r\n` -> `\n`
2. remaining `\r` -> `\n`
3. no trimming/reindent

### 5.4 Path normalization rules

All USR path-bearing fields MUST be repo-relative and POSIX-normalized.

Required rules:

1. convert `\` to `/`
2. reject absolute paths
3. reject `..` path traversal segments
4. collapse redundant separators
5. preserve case exactly as observed from discovery

### 5.5 Null, empty, and omission semantics

USR producers MUST use the following semantics consistently.

- `null`: known-unknown or explicitly unavailable value
- empty array/object: known-empty collection
- omitted field: field not part of entity profile/schema surface for this version

Writers MUST NOT use omission and `null` interchangeably for fields defined as nullable.

### 5.6 Numeric normalization

All floating-point values in persisted USR payloads MUST be finite.

- NaN and Infinity are forbidden
- confidence-like values MUST be clamped to `[0, 1]`
- persisted confidence values SHOULD be rounded to 6 decimal places for stable diffs

## 6. Identity Model

### 6.1 Identity primitives

USR uses the following identities.

- `docUid`: stable document identity (container or virtual segment document)
- `segmentUid`: stable segment identity (from identity contract)
- `nodeUid`: stable-ish syntax node identity
- `symbolUid`: canonical symbol identity wrapper
- `edgeUid`: canonical relation identity

### 6.2 `docUid` algorithm (normative)

`docUid` MUST be computed as:

`docUid = "doc64:v1:" + checksumString("doc\0" + namespaceKey + "\0" + virtualPath)`

Where:

- `namespaceKey`: repo namespace key
- `virtualPath`: `fileRelPath` for container docs, `fileRelPath#seg:<segmentUid>` for virtual segment docs

### 6.3 `segmentUid` algorithm

`segmentUid` MUST use the algorithm in `docs/specs/identity-contract.md`.

### 6.4 `nodeUid` algorithm (normative)

`nodeUid` MUST be computed from:

- `docUid`
- `normKind`
- normalized node span text
- normalized pre/post context windows
- stable local ordinal for unresolved collisions

Canonical form:

`n64:v1:<hash>`

with hash input:

`"node\0" + docUid + "\0" + normKind + "\0" + spanHash + "\0" + preHash + "\0" + postHash + "\0" + ordinal`

### 6.5 `symbolUid`

`symbolUid` MUST wrap the canonical identity sources in precedence order:

1. external semantic ID (`scip:`/`lsif:`/`lsp:`) if available
2. `scopedId`
3. fallback derived from `symbolKey + declaration nodeUid`

Canonical string prefix:

`symu:v1:`

### 6.6 `edgeUid`

`edgeUid` MUST be deterministic and include:

- edge kind
- source ref
- target ref
- status
- range hash (if range-bearing)

Canonical string prefix:

`edge64:v1:`

### 6.7 Canonical ID grammar

All canonical USR IDs MUST match these patterns.

- `docUid`: `^doc64:v1:[a-f0-9]{16}$`
- `segmentUid`: `^segu:v1:[a-f0-9]{16}$`
- `nodeUid`: `^n64:v1:[a-f0-9]{16}$`
- `symbolUid`: `^symu:v1:[a-z0-9:_\\-\\.]+$`
- `edgeUid`: `^edge64:v1:[a-f0-9]{16}$`
- `routeUid`: `^route64:v1:[a-f0-9]{16}$`
- `scopeUid`: `^scope64:v1:[a-f0-9]{16}$`
- `diagnosticUid`: `^diag64:v1:[a-f0-9]{16}$`

If an upstream identity source does not match canonical pattern requirements, producers MUST adapt it into a canonical USR wrapper ID and preserve the original value in `attrs.originalId`.

## 7. Canonical USR Entity Schemas

### 7.1 `USRDocumentV1`

```ts
type USRDocumentV1 = {
  schemaVersion: "usr-1.0.0";
  docUid: string;
  namespaceKey: string;
  fileRelPath: string;
  virtualPath: string;
  containerExt: string | null;
  containerLanguageId: string | null;
  effectiveLanguageId: string | null;
  parserLanguageId: string | null;
  encoding: string | null;
  textHash: { algo: "xxh64" | "sha1"; value: string };
  segmentUid: string | null;
  segmentKind: "file" | "embedded" | "template" | "style" | "frontmatter" | "prose" | "config" | "comment";
  frameworkProfiles: string[];
  capabilities: USRCapabilityState;
  diagnostics: string[]; // diagnosticUid refs
  provenance: {
    buildId: string | null;
    mode: "code" | "prose" | "extracted-prose" | "records";
    parserRuntime: string | null;
    registrySignature: string | null;
    generatedAt: string;
  };
};
```

### 7.2 `USRSegmentV1`

```ts
type USRSegmentV1 = {
  schemaVersion: "usr-1.0.0";
  segmentUid: string;
  segmentId: string | null; // legacy range-based id
  parentSegmentUid: string | null;
  docUid: string;
  kind: "code" | "template" | "style" | "prose" | "comment" | "config" | "embedded" | "frontmatter" | "route";
  containerRange: USRRange;
  virtualRange: USRRange;
  effectiveExt: string | null;
  effectiveLanguageId: string | null;
  parserLanguageId: string | null;
  frameworkProfile: string | null;
  extraction: {
    method: "native-parser" | "tree-sitter" | "compiler-api" | "framework-compiler" | "heuristic";
    confidence: number; // 0..1
    partial: boolean;
  };
  textHash: { algo: "xxh64"; value: string };
  flags: {
    synthetic: boolean;
    generated: boolean;
    minified: boolean;
  };
  diagnostics: string[];
};
```

### 7.3 `USRNodeV1`

```ts
type USRNodeV1 = {
  schemaVersion: "usr-1.0.0";
  nodeUid: string;
  docUid: string;
  segmentUid: string | null;
  parentNodeUid: string | null;
  rawKind: string;
  normKind: USRNormNodeKind;
  category: USRNodeCategory;
  containerRange: USRRange;
  virtualRange: USRRange;
  textHash: { algo: "xxh64"; value: string };
  flags: string[];
  attrs: Record<string, unknown>;
  parser: {
    source: "native-parser" | "tree-sitter" | "framework-compiler" | "heuristic";
    languageId: string | null;
    grammar: string | null;
    version: string | null;
  };
  diagnostics: string[];
};
```

### 7.4 `USRSymbolV1`

```ts
type USRSymbolV1 = {
  schemaVersion: "usr-1.0.0";
  symbolUid: string;
  symbolId: string | null;
  scopedId: string | null;
  symbolKey: string;
  signatureKey: string | null;
  languageId: string | null;
  kind: USRSymbolKind;
  kindGroup: string;
  name: string;
  qualifiedName: string | null;
  declarationNodeUid: string | null;
  declarationDocUid: string;
  declarationSegmentUid: string | null;
  exported: boolean;
  visibility: "public" | "protected" | "private" | "internal" | "package" | "unknown";
  modifiers: string[];
  frameworkRole: "component" | "hook" | "composable" | "directive" | "route" | "store" | "none";
  types: {
    declared?: USRTypeBucket;
    inferred?: USRTypeBucket;
    tooling?: USRTypeBucket;
  };
  diagnostics: string[];
};
```

### 7.5 `USREdgeV1`

```ts
type USREdgeV1 = {
  schemaVersion: "usr-1.0.0";
  edgeUid: string;
  kind: USREdgeKind;
  source: USRRef;
  target: USRRef;
  languageId: string | null;
  frameworkProfile: string | null;
  status: "resolved" | "ambiguous" | "unresolved" | "derived" | "suppressed";
  confidence: number | null;
  containerRange: USRRange | null;
  virtualRange: USRRange | null;
  attrs: Record<string, unknown>;
  evidence: {
    source: "parser" | "compiler" | "tooling" | "heuristic" | "inference";
    notes?: string[];
  };
  diagnostics: string[];
};
```

### 7.6 `USRFlowPathV1`

```ts
type USRFlowPathV1 = {
  schemaVersion: "usr-1.0.0";
  pathUid: string;
  flowKind: "control" | "data" | "risk";
  languageId: string | null;
  nodeRefs: USRRef[];
  edgeRefs: string[]; // edgeUid list
  truncated: boolean;
  truncationReason: string | null;
  confidence: number | null;
  diagnostics: string[];
};
```

### 7.7 `USRRouteV1`

```ts
type USRRouteV1 = {
  schemaVersion: "usr-1.0.0";
  routeUid: string;
  framework: "next" | "nuxt" | "sveltekit" | "angular" | "react-router" | "vue-router" | "astro";
  pattern: string;
  file: string;
  segmentUid: string | null;
  symbolUid: string | null;
  method: string | null;
  runtimeSide: "server" | "client" | "universal" | "unknown";
  attrs: Record<string, unknown>;
};
```

### 7.8 `USRStyleScopeV1`

```ts
type USRStyleScopeV1 = {
  schemaVersion: "usr-1.0.0";
  scopeUid: string;
  framework: "vue" | "svelte" | "react" | "angular" | "astro" | "none";
  scopeType: "scoped" | "module" | "global" | "shadow" | "unknown";
  segmentUid: string | null;
  ownerSymbolUid: string | null;
  selectorHashes: string[];
  attrs: Record<string, unknown>;
};
```

### 7.9 `USRDiagnosticV1`

```ts
type USRDiagnosticV1 = {
  schemaVersion: "usr-1.0.0";
  diagnosticUid: string;
  code: string;
  severity: "error" | "warning" | "info";
  phase: "segment" | "parse" | "normalize" | "symbolize" | "relate" | "flow" | "risk" | "framework";
  message: string;
  languageId: string | null;
  frameworkProfile: string | null;
  docUid: string | null;
  segmentUid: string | null;
  nodeUid: string | null;
  range: USRRange | null;
  capabilityImpact: string[];
};
```

### 7.10 Shared structs

```ts
type USRRange = {
  start: number;
  end: number;
  startLine: number | null;
  endLine: number | null;
  startCol: number | null;
  endCol: number | null;
};

type USRRef = {
  entity: "document" | "segment" | "node" | "symbol";
  uid: string;
};

type USRTypeEntry = {
  type: string;
  source?: string | null;
  confidence?: number | null;
  shape?: string | null;
  elements?: string[] | null;
  evidence?: string[] | null;
};

type USRTypeBucket = {
  returns?: USRTypeEntry[];
  params?: Record<string, USRTypeEntry[]>;
  fields?: Record<string, USRTypeEntry[]>;
  locals?: Record<string, USRTypeEntry[]>;
};

type USRCapabilityState = {
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
};
```

### 7.11 Entity integrity constraints (normative)

The following constraints are REQUIRED for schema-valid USR payloads.

`USRRange`:

- `start >= 0`
- `end >= start`
- if `startLine` is non-null then `startLine >= 1`
- if `endLine` is non-null then `endLine >= startLine`

`USRSegmentV1`:

- `segmentUid` MUST be unique within a build+mode output scope
- `containerRange` MUST be contained by the owning container document bounds
- `virtualRange` MUST be contained by virtual document bounds
- `effectiveLanguageId` MUST be a registry language ID or null

`USRNodeV1`:

- `nodeUid` MUST be unique within a build+mode output scope
- `parentNodeUid` MUST resolve to an existing node in the same `docUid` unless null
- `containerRange` and `virtualRange` MUST both be valid and non-empty for concrete syntax nodes

`USRSymbolV1`:

- `symbolUid` MUST be unique
- `symbolKey` MUST be non-empty
- if `declarationNodeUid` is non-null it MUST resolve to an existing `USRNodeV1`
- `kindGroup` MUST be deterministic for the same symbol identity across runs

`USREdgeV1`:

- `edgeUid` MUST be unique
- `source.uid` and `target.uid` MUST resolve to existing entities of declared `USRRef.entity` type
- self-edges are allowed only for `ast_parent` with explicit `attrs.selfLoopReason`
- `status=resolved` MUST NOT have null source/target refs

`USRFlowPathV1`:

- `pathUid` MUST be unique
- all `nodeRefs` and `edgeRefs` MUST resolve
- `truncated=true` MUST include non-null `truncationReason`

`USRDiagnosticV1`:

- `diagnosticUid` MUST be unique
- `code` MUST match `^USR-[EWI]-[A-Z0-9-]+$`
- `severity` MUST align with code prefix (`E`->error, `W`->warning, `I`->info)

### 7.12 Reference resolution envelope (normative)

Any unresolved or ambiguous reference represented in USR edges MUST include a deterministic resolution envelope under `attrs.resolution`.

Canonical shape:

```ts
type USRResolutionEnvelope = {
  status: "resolved" | "ambiguous" | "unresolved";
  targetName: string | null;
  resolver: "language-native" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic";
  reasonCode: string | null;
  candidates: Array<{
    uid: string;
    entity: "document" | "segment" | "node" | "symbol";
    confidence: number | null;
    why: string | null;
  }>;
};
```

Rules:

- `status` MUST match `USREdgeV1.status` for unresolved/ambiguous/resolved outcomes.
- `candidates` MUST be deterministically sorted by confidence descending, then uid lexical.
- unresolved edges MUST include non-null `reasonCode`.
- ambiguous edges MUST include at least two candidates.

## 8. Canonical Taxonomies

### 8.1 Node categories

`USRNodeCategory` enum:

- `module`
- `namespace`
- `type`
- `callable`
- `variable`
- `property`
- `import`
- `export`
- `control`
- `expression`
- `literal`
- `markup`
- `style`
- `query`
- `template`
- `directive`
- `build`
- `comment`
- `unknown`

### 8.2 Normalized node kinds

`USRNormNodeKind` MUST be chosen from the canonical set.

- `file`, `module_decl`, `namespace_decl`
- `class_decl`, `interface_decl`, `trait_decl`, `enum_decl`, `type_alias_decl`
- `function_decl`, `method_decl`, `constructor_decl`, `lambda_expr`
- `variable_decl`, `field_decl`, `param_decl`
- `import_decl`, `export_decl`
- `call_expr`, `member_expr`, `assign_expr`, `return_stmt`, `throw_stmt`
- `if_stmt`, `switch_stmt`, `loop_stmt`, `try_stmt`, `catch_clause`
- `jsx_element`, `jsx_attribute`, `template_element`, `template_binding`
- `html_element`, `html_attribute`, `css_rule`, `css_selector`
- `sql_stmt`, `sql_table_ref`, `graphql_type_decl`, `graphql_field_decl`
- `proto_message_decl`, `proto_service_decl`, `build_target_decl`
- `unknown`

### 8.3 Symbol kinds

`USRSymbolKind` MUST be one of:

- `module`, `namespace`, `class`, `interface`, `trait`, `enum`, `typeAlias`
- `function`, `method`, `constructor`, `lambda`
- `variable`, `field`, `parameter`, `property`
- `component`, `hook`, `composable`, `directive`, `route`, `service`
- `template`, `query`, `message`, `target`
- `unknown`

### 8.4 Edge kinds

`USREdgeKind` MUST be one of:

- `ast_parent`
- `defines`
- `declares`
- `references`
- `calls`
- `imports`
- `exports`
- `extends`
- `implements`
- `uses_type`
- `contains`
- `template_binds`
- `template_emits`
- `style_scopes`
- `route_maps_to`
- `control_next`
- `data_def_use`
- `risk_source`
- `risk_sink`
- `risk_flow`
- `sanitizes`
- `hydration_boundary`

### 8.5 Edge endpoint constraints

Allowed endpoint kinds are normative.

- `ast_parent`: source=node, target=node
- `defines`: source=node, target=symbol
- `declares`: source=node, target=symbol
- `references`: source=node|symbol, target=symbol|node
- `calls`: source=node|symbol, target=symbol|node
- `imports`: source=document|segment|node, target=document|segment|symbol
- `exports`: source=node|symbol, target=symbol|document
- `extends`: source=symbol, target=symbol
- `implements`: source=symbol, target=symbol
- `uses_type`: source=symbol|node, target=symbol|node
- `contains`: source=document|segment|node, target=segment|node|symbol
- `template_binds`: source=node|segment, target=symbol|node
- `template_emits`: source=node|segment, target=symbol|node
- `style_scopes`: source=segment|node, target=symbol
- `route_maps_to`: source=node|symbol, target=symbol|document
- `control_next`: source=node, target=node
- `data_def_use`: source=node|symbol, target=node|symbol
- `risk_source`: source=node|symbol, target=node|symbol
- `risk_sink`: source=node|symbol, target=node|symbol
- `risk_flow`: source=node|symbol, target=node|symbol
- `sanitizes`: source=node|symbol, target=node|symbol
- `hydration_boundary`: source=node|symbol, target=node|symbol

Producers MUST reject edges with invalid endpoint entity combinations.

## 9. Language Profile Contract

Every registry language ID MUST have a `USRLanguageProfile`.

Normative decomposition:

- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr/languages/README.md`

```ts
type USRLanguageProfile = {
  id: string; // registry language id
  parserPreference: "native" | "tree-sitter" | "hybrid" | "heuristic";
  requiredCategories: USRNodeCategory[];
  requiredEdgeKinds: USREdgeKind[];
  requiredCapabilities: Partial<USRCapabilityState>;
  frameworkProfiles: string[];
  notes?: string;
};
```

### 9.1 Required per-language baseline profiles

| Language ID | Parser Preference | Required Categories | Required Edge Kinds | Framework Profiles |
| --- | --- | --- | --- | --- |
| javascript | hybrid | module, callable, expression, template | imports, calls, references, template_binds | react, next, astro |
| typescript | hybrid | module, type, callable, expression, template | imports, calls, references, uses_type, template_binds | react, next, angular, astro |
| python | native/hybrid | module, callable, type, control | imports, calls, references | none |
| clike | tree-sitter/hybrid | module, callable, type, control | imports, calls, references | none |
| go | native/hybrid | module, callable, type, control | imports, calls, references | none |
| java | native/hybrid | module, callable, type, control | imports, calls, references, extends, implements | none |
| csharp | tree-sitter/hybrid | module, callable, type, control | imports, calls, references, extends, implements | none |
| kotlin | tree-sitter/hybrid | module, callable, type, control | imports, calls, references, extends, implements | none |
| ruby | tree-sitter/hybrid | module, callable, type | imports, calls, references | none |
| php | tree-sitter/hybrid | module, callable, type | imports, calls, references | none |
| html | tree-sitter/hybrid | markup, template | contains, references | vue, angular, astro |
| css | tree-sitter/hybrid | style | contains, style_scopes | vue, svelte, react, angular, astro |
| lua | tree-sitter/hybrid | module, callable, expression | imports, calls, references | none |
| sql | tree-sitter/hybrid | query | references | none |
| perl | tree-sitter/hybrid | module, callable, expression | imports, calls, references | none |
| shell | tree-sitter/hybrid | module, callable, expression | imports, calls, references | none |
| rust | tree-sitter/hybrid | module, callable, type, control | imports, calls, references, uses_type, implements | none |
| swift | tree-sitter/hybrid | module, callable, type, control | imports, calls, references, extends, implements | none |
| cmake | heuristic/tree-sitter | build, module | imports, references | none |
| starlark | heuristic/tree-sitter | build, callable, module | imports, references, calls | none |
| nix | tree-sitter/hybrid | module, expression | imports, references | none |
| dart | tree-sitter/hybrid | module, callable, type, control | imports, calls, references, uses_type | none |
| scala | tree-sitter/hybrid | module, callable, type, control | imports, calls, references, uses_type | none |
| groovy | tree-sitter/hybrid | module, callable, type, control | imports, calls, references | none |
| r | tree-sitter/hybrid | module, callable, expression | imports, calls, references | none |
| julia | tree-sitter/hybrid | module, callable, expression | imports, calls, references | none |
| handlebars | parser/heuristic | template | template_binds, references | none |
| mustache | parser/heuristic | template | template_binds, references | none |
| jinja | parser/heuristic | template | template_binds, references, imports | none |
| razor | parser/heuristic | template, callable | template_binds, references | none |
| proto | tree-sitter/hybrid | module, type | imports, references, defines | none |
| makefile | heuristic/tree-sitter | build, module | imports, references, calls | none |
| dockerfile | parser/heuristic | build | references | none |
| graphql | parser/heuristic | query, type | references, defines | none |

## 10. Framework Profile Contract

Framework profiles are overlays on top of language profiles. Each profile defines additional required entities and edges.

Normative decomposition:

- `docs/specs/usr-framework-profile-catalog.md`

### 10.1 React profile

Detection:

- `.jsx`/`.tsx` segment or file
- React runtime patterns (import/react-jsx runtime)
- package/config indicators (`react`, framework adapters)

Required outputs:

- component symbols (`frameworkRole=component`)
- hook symbols/uses (`frameworkRole=hook`)
- JSX element/component reference edges
- prop/data binding edges where statically resolvable
- client/server runtime side markers where inferable

Required edge kinds:

- `template_binds`, `references`, `calls`

Risk requirements:

- identify `dangerouslySetInnerHTML` sink edges (`risk_sink`)

Additional constraints:

- hook identification MUST include built-in hooks and user hooks (`use*` prefix) with confidence tags
- component symbol extraction MUST cover function and class components
- JSX fragment handling MUST NOT collapse child binding edges

### 10.2 Vue 3 profile

Detection:

- `.vue` container
- Vue package/config signals

Required segmentation:

- template block
- script block
- script setup block
- style blocks (scoped/module/global)
- custom block segments as `kind=config` with profile attrs

Required outputs:

- template AST nodes
- script symbol nodes
- template-to-script binding edges (`template_binds`)
- emits/props relations (`template_emits` and `references`)
- style scope records
- script-setup binding metadata captured in `attrs`

Risk requirements:

- `v-html` sink detection (`risk_sink`)

Additional constraints:

- template directive bindings (`v-bind`, `v-on`, `v-model`, `v-if`, `v-for`) MUST map to deterministic binding edges
- emitted event symbols MUST distinguish declared emits from inferred emits
- scoped-style ownership MUST map style scopes to component symbol where resolvable

### 10.3 Next.js profile

Detection:

- next package/config
- app/pages conventions
- route-segment conventions for server/client boundaries

Required outputs:

- route records (`USRRouteV1`)
- route-to-component edges (`route_maps_to`)
- server/client boundary markers
- hydration boundary edges (`hydration_boundary`) where inferred

Additional constraints:

- app-router and pages-router MUST both be supported
- route pattern normalization MUST produce stable parameter tokens
- API route handlers MUST emit `runtimeSide=server` unless explicitly marked edge/universal

### 10.4 Nuxt 3 profile

Detection:

- nuxt package/config
- pages/composables/server conventions

Required outputs:

- route records
- composable symbols
- server handler symbols
- route/component/server linkage edges

Additional constraints:

- `server/api` and `server/routes` handlers MUST be represented as server-side route-linked symbols
- composables in canonical composables paths MUST be tagged `frameworkRole=composable`

### 10.5 Svelte/SvelteKit profile

Detection:

- `.svelte` container and/or svelte package

Required segmentation:

- module script
- instance script
- template
- style

Required outputs:

- template/script binding edges
- style scope records
- SvelteKit route records when conventions are present

Additional constraints:

- both module and instance scripts MUST be represented as distinct segments
- Svelte binding directives (`bind:`, `on:`, `let:`) MUST emit deterministic binding edges
- style scope attribution MUST differentiate local-scoped vs global selectors when derivable

### 10.6 Angular profile

Detection:

- angular packages/config
- decorator metadata

Required outputs:

- component/directive/service symbols
- template binding edges
- route records
- decorator metadata in node attrs

Additional constraints:

- standalone and module-based component patterns MUST both be represented
- template URL and inline template flows MUST produce equivalent binding edge shapes
- input/output bindings MUST map to `template_binds`/`template_emits` edges with deterministic naming

### 10.7 Astro profile

Detection:

- `.astro` container and/or astro package

Required segmentation:

- frontmatter script segment
- template segment
- style/script embedded segments

Required outputs:

- frontmatter symbol extraction
- template binding edges
- framework component import/reference edges

Additional constraints:

- frontmatter script symbols MUST be joinable to template references through binding edges
- framework island boundaries SHOULD emit profile attrs for downstream hydration analysis

## 11. Pipeline Contract

Normalization mapping decomposition:

- `docs/specs/usr-normalization-mapping-contract.md`

USR pipeline stages MUST execute in deterministic order.

1. discovery
2. segmentation
3. parser selection and parse
4. node normalization
5. symbolization
6. relation extraction
7. flow extraction
8. risk extraction
9. framework overlay enrichment
10. final ordering and validation

### 11.1 Parser selection rules

For each segment, parser selection MUST follow profile preference with deterministic fallback.

- native preferred when profile says native/hybrid and runtime is available
- tree-sitter used when configured and grammar exists
- framework compiler used for container formats requiring it
- heuristic fallback only after deterministic failure of higher-preference parser

### 11.2 Fallback requirements

Fallback MUST NOT silently drop capability state.

- capability state must switch to `partial` or `unsupported`
- diagnostic entry must be emitted
- emitted entities must still satisfy schema

### 11.3 Parser source precedence matrix

For each segment, producer selection MUST follow deterministic precedence:

1. framework compiler/parser (for container formats requiring framework decomposition)
2. language-native parser
3. tree-sitter parser
4. deterministic heuristic parser

If multiple candidates exist at the same precedence level:

1. prefer candidate with higher declared profile confidence
2. then prefer lower expected degradation footprint
3. then lexical tie-break by parser source id string

The selected parser source MUST be recorded in entity parser/extraction metadata.

### 11.4 Normalization mapping requirements

Normalization from raw parser nodes to `USRNormNodeKind` MUST be deterministic and table-driven.

Minimum mapping rules:

- preserve raw kind in `rawKind` exactly as reported by source parser
- map unsupported/unknown raw kinds to `normKind=unknown`
- map language-specific synonyms to canonical kinds
- avoid emitting parser-specific aliases as canonical kinds

Canonical language-family mapping examples:

- JS/TS/JSX/TSX: `FunctionDeclaration`, `function_declaration` -> `function_decl`
- Python: `FunctionDef`, `AsyncFunctionDef` -> `function_decl`
- C-like: `function_definition` -> `function_decl`
- HTML/Vue/Svelte template AST: element tags -> `html_element` or `template_element` depending on profile
- CSS rules/selectors -> `css_rule`, `css_selector`
- SQL statements -> `sql_stmt`
- GraphQL type/field definitions -> `graphql_type_decl`, `graphql_field_decl`

### 11.5 Framework extraction ordering

For framework containers (`.vue`, `.svelte`, `.astro`, Angular template surfaces), extraction MUST occur in this order:

1. block segmentation
2. virtual document creation and range mapping
3. parser/compiler execution per block
4. block-local node/symbol extraction
5. cross-block binding edge construction
6. framework-specific enrichment (routes, style scopes, hydration boundaries)

Any failure after step 1 MUST preserve segment outputs and emit degradation diagnostics instead of dropping the container file from USR output.

## 12. Degradation and Error Semantics

Resolution and linking decomposition:

- `docs/specs/usr-resolution-and-linking-contract.md`

### 12.1 Required diagnostic codes

USR diagnostics MUST use stable codes. Minimum set:

- `USR-E-PARSER-UNAVAILABLE`
- `USR-E-PARSER-FAILED`
- `USR-E-SEGMENT-INVALID-RANGE`
- `USR-E-SCHEMA-VIOLATION`
- `USR-E-CAPABILITY-LOST`
- `USR-W-PARTIAL-PARSE`
- `USR-W-CAPABILITY-DOWNGRADED`
- `USR-W-FRAMEWORK-PROFILE-INCOMPLETE`
- `USR-I-FALLBACK-HEURISTIC`

### 12.2 Partial support behavior

If a capability is partial or unsupported:

- state MUST be explicit in `capabilities`
- missing outputs MUST be represented as deterministic empties where required by artifact contract
- diagnostics MUST identify phase and reason

### 12.3 Capability state machine

Each capability in `USRCapabilityState` MUST follow this finite-state model:

- initial state: `unsupported`
- transitions:
  - `unsupported` -> `partial`
  - `unsupported` -> `supported`
  - `partial` -> `supported`
  - `supported` -> `partial` (only when degradation/fallback occurs)
  - `partial` -> `unsupported` (only when hard failure invalidates previously emitted partial output)

Transitions MUST emit diagnostics:

- any transition into `partial` MUST emit `USR-W-CAPABILITY-DOWNGRADED`
- any transition into `unsupported` after prior non-unsupported state MUST emit `USR-E-CAPABILITY-LOST`

### 12.4 Diagnostic severity mapping

Severity MUST be computed deterministically:

- parser crash, schema failure, invalid identity, or broken references -> `error`
- downgraded capability, partial parse, incomplete framework extraction -> `warning`
- fallback path selected with valid output -> `info`

Implementations MUST NOT emit free-form severities.

## 13. Determinism Requirements

USR output order MUST be deterministic with these tie-breakers.

### 13.1 Documents

Sort by `virtualPath`, then `docUid`.

### 13.2 Segments

Sort by `docUid`, then `containerRange.start`, then `kind`, then `segmentUid`.

### 13.3 Nodes

Sort by `docUid`, then `virtualRange.start`, then `virtualRange.end`, then `normKind`, then `nodeUid`.

### 13.4 Symbols

Sort by `languageId`, then `qualifiedName`, then `kind`, then `symbolUid`.

### 13.5 Edges

Sort by `kind`, `source.uid`, `target.uid`, `status`, `edgeUid`.

### 13.6 Hashing and IDs

All ID hashes MUST use stable algorithm/version tags and identical normalization inputs across runs.

### 13.7 Canonical serialization profile

When USR artifacts are persisted, canonical JSON serialization MUST satisfy all of the following:

- encoding: UTF-8 without BOM
- newline: `\\n`
- object key ordering: lexical ascending
- array ordering: as defined by deterministic ordering rules in this spec
- numbers: finite only, no exponent normalization drift in stringified output
- string escaping: JSON standard escaping only (no custom escape policies)

Writers MUST NOT include non-deterministic fields in canonical payloads.

Examples of forbidden nondeterministic payload values:

- process IDs
- hostnames
- wall-clock timestamps except top-level provenance timestamps where required
- randomized ordering in `attrs` maps

## 14. Storage Contract for Optional Persisted USR Artifacts

When persisted, USR artifacts MUST use manifest-first discovery and sharded JSONL meta rules from existing artifact contracts.

Recommended artifact names:

- `usr_documents`
- `usr_segments`
- `usr_nodes`
- `usr_symbols`
- `usr_edges`
- `usr_flows`
- `usr_routes`
- `usr_style_scopes`
- `usr_diagnostics`

Each persisted USR artifact MUST include:

- `schemaVersion`
- deterministic ordering
- `generatedAt`
- `compatibilityKey` inputs aligned with current index compatibility policy

## 15. Mapping to Existing Artifacts

USR is additive and maps to current surfaces.

- `USRDocumentV1`/`USRSegmentV1` -> `chunk_meta.metaV2`, VFS manifest surfaces
- `USRNodeV1` -> parser/docmeta internals (optional persisted USR node artifact)
- `USRSymbolV1` -> `symbols` artifact
- `USREdgeV1` -> `symbol_edges`, `file_relations`, `graph_relations`
- `USRFlowPathV1` -> risk/flow artifacts (`risk_flows`, call/risk summaries)
- `USRDiagnosticV1` -> diagnostics and warning envelopes

## 16. Conformance Requirements

Conformance/fixture decomposition:

- `docs/specs/usr-conformance-and-fixture-contract.md`

USR conformance has five levels.

- `C0` segmentation and coordinate integrity
- `C1` symbols and imports/relations baseline
- `C2` AST plus control/data flow where profile requires
- `C3` risk local/interprocedural where profile requires
- `C4` framework overlays and route/template/style semantics

### 16.1 Minimum level by profile

- All languages MUST pass `C0` and `C1`.
- Languages with AST profile requirements MUST pass `C2`.
- Languages with risk profile requirements MUST pass `C3`.
- Framework profiles MUST pass `C4`.

### 16.2 Required test characteristics

Conformance tests MUST include:

- positive fixtures
- negative fixtures
- malformed input fixtures
- deterministic rerun comparison
- capability downgrade assertions

### 16.3 Level pass criteria (normative)

`C0` pass criteria:

- range validity checks pass
- segment to document containment checks pass
- coordinate dual-space mapping checks pass

`C1` pass criteria:

- symbol integrity checks pass
- import/relation baseline checks pass
- edge endpoint constraints pass

`C2` pass criteria:

- AST normalization checks pass where required
- control/data flow checks pass where required
- unsupported capabilities assert explicit `unsupported` states

`C3` pass criteria:

- local risk checks pass where required
- interprocedural risk checks pass where required
- sanitizer edge semantics validate where emitted

`C4` pass criteria:

- framework segmentation checks pass
- framework binding/route/style checks pass
- framework risk/degradation checks pass

### 16.4 Determinism pass criteria (normative)

For every conformance level, deterministic rerun checks MUST include:

- same `docUid`, `segmentUid`, `nodeUid`, `symbolUid`, `edgeUid` sets
- byte-equal sorted JSON serialization for persisted USR artifacts when enabled
- identical capability states and diagnostic code distributions

### 16.5 Minimum fixture families

Conformance fixtures MUST include these families:

- language-baseline fixtures for every registry language ID
- framework-baseline fixtures for every required framework profile
- malformed fixtures for segmentation and parser failures
- large-file and truncation fixtures to validate cap handling
- mixed-repo fixtures covering cross-language and framework boundaries

## 17. Performance and Resource Requirements

USR extraction SHOULD honor global lane budgets and enforce per-unit caps.

Minimum requirements:

- hard cap on parser time per segment
- hard cap on output node/edge/path counts per document
- truncation diagnostics when caps trigger
- no unbounded in-memory accumulation for large repositories

If caps trigger, outputs MUST remain schema-valid and deterministic.

## 18. Security and Safety Requirements

USR implementations MUST:

- reject unsafe/invalid paths (`..`, absolute paths) in persisted references
- avoid executing untrusted code during parse/analysis
- bound regex and parser workloads
- record degraded execution rather than silently skipping work

### 18.1 Data sensitivity and redaction policy

USR artifacts MUST avoid persisting secrets or high-risk sensitive values.

Minimum required redaction behavior:

- redact known secret-bearing token patterns in diagnostic messages and attrs values
- never persist raw environment variable values when reported as risk sources
- truncate raw source snippets in diagnostics to bounded safe excerpts
- preserve structural context while replacing sensitive values with deterministic placeholders

Canonical placeholder format:

- `<redacted:<reason-code>>`

Redaction actions MUST emit a diagnostic or provenance counter so downstream consumers can distinguish true-empty from redacted values.

### 18.2 Supply-chain parser/runtime controls

Parser/compiler/tooling runtimes used for USR extraction MUST be version-pinned by policy.

Required behavior:

- record runtime id and version in provenance
- fail closed or degrade with explicit diagnostics when runtime identity is unknown
- prevent silent runtime auto-upgrades from changing deterministic behavior in CI lanes

## 19. Versioning and Compatibility

### 19.1 USR schema version

USR uses SemVer with prefix `usr-`.

Initial version:

- `usr-1.0.0`

### 19.2 Breaking changes

Any change to required fields, required taxonomies, or ID algorithm semantics is a breaking change and MUST bump major version.

### 19.3 Compatibility key inputs

If persisted USR artifacts are enabled, compatibility key MUST include:

- USR major version
- ID algorithm versions
- language profile registry hash
- framework profile registry hash
- parser/runtime policy hash

## 20. Implementation Checklist

Before declaring full support complete, all items below MUST be true.

- All registry languages have `USRLanguageProfile` entries.
- All required framework profiles are implemented and conformance-tested.
- All required entity schemas validate in strict mode.
- All deterministic ordering checks pass under reruns.
- All downgrade paths emit explicit capability states and diagnostics.
- Existing artifact contracts remain compatible.
- Decomposed USR contract suite remains synchronized with umbrella sections.
- Every registry language has a maintained per-language contract under `docs/specs/usr/languages/`.
- Embedded-language bridge rules are implemented for all multi-block/framework containers.
- Generated/macro/transpiled provenance retention rules are enforced and conformance-tested.

## 21. Immediate Integration Tasks

1. Add `USRLanguageProfile` and framework profile registries in `tests/lang/matrix` as canonical data files.
2. Add strict schema validators for USR entities under `src/contracts/schemas`.
3. Add conformance lane materialization from language/framework profile matrices.
4. Wire capability-state assertions into phase gates before broad language lane rollout.
5. Add migration mappers between USR entities and existing artifact surfaces.

## 22. References

- `docs/specs/metadata-schema-v2.md`
- `docs/specs/identity-contract.md`
- `docs/specs/identity-and-symbol-contracts.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `docs/specs/usr/README.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-language-risk-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-embedding-bridge-contract.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/contracts/public-artifact-surface.md`
- `docs/contracts/artifact-schemas.md`
- `docs/contracts/analysis-schemas.md`
- `src/index/language-registry/registry-data.js`

## 23. Required machine-readable registries

USR requires machine-readable registries to prevent doc drift.

Required files:

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`
- `tests/lang/matrix/usr-framework-profiles.json`
- `tests/lang/matrix/usr-node-kind-mapping.json`
- `tests/lang/matrix/usr-edge-kind-constraints.json`
- `tests/lang/matrix/usr-capability-matrix.json`
- `tests/lang/matrix/usr-conformance-levels.json`
- `tests/lang/matrix/usr-framework-edge-cases.json`
- `tests/lang/matrix/usr-language-risk-profiles.json`
- `tests/lang/matrix/usr-backcompat-matrix.json`
- `tests/lang/matrix/usr-embedding-bridge-cases.json`
- `tests/lang/matrix/usr-generated-provenance-cases.json`

Registry drift policy:

- registry language IDs and `usr-language-profiles.json` entries MUST be exact-set equal
- registry language IDs and `usr-language-version-policy.json` entries MUST be exact-set equal
- registry language IDs and `usr-language-embedding-policy.json` entries MUST be exact-set equal
- framework profile IDs referenced by language profiles MUST exist in `usr-framework-profiles.json`
- unknown keys in registry JSON MUST fail strict schema validation
- every registry language ID MUST have exactly one per-language contract file under `docs/specs/usr/languages/`
- schema key changes in machine-readable registries MUST be accompanied by synchronized updates in decomposed contract docs

## 24. Required schema package and validators

USR entity schemas MUST be defined and validated in code.

Required schema modules:

- `src/contracts/schemas/usr.js`
- `src/contracts/validators/usr.js`

Required top-level schema exports:

- `USR_DOCUMENT_SCHEMA`
- `USR_SEGMENT_SCHEMA`
- `USR_NODE_SCHEMA`
- `USR_SYMBOL_SCHEMA`
- `USR_EDGE_SCHEMA`
- `USR_FLOW_PATH_SCHEMA`
- `USR_ROUTE_SCHEMA`
- `USR_STYLE_SCOPE_SCHEMA`
- `USR_DIAGNOSTIC_SCHEMA`

Validation policy:

- strict mode MUST reject unknown required enum values
- strict mode MUST enforce ID grammar and endpoint constraints
- non-strict mode MAY allow additive fields only when explicitly configured

## 25. Framework to language applicability matrix

Framework profiles MUST only apply to allowed effective language IDs unless explicitly extended.

| Framework | Allowed effective language IDs | Allowed container extensions |
| --- | --- | --- |
| react | `javascript`, `typescript` | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts` |
| vue | `javascript`, `typescript`, `html`, `css` | `.vue` |
| next | `javascript`, `typescript` | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts` |
| nuxt | `javascript`, `typescript`, `html`, `css` | `.vue`, `.js`, `.ts` |
| svelte | `javascript`, `typescript`, `html`, `css` | `.svelte` |
| sveltekit | `javascript`, `typescript`, `html`, `css` | `.svelte`, `.js`, `.ts` |
| angular | `typescript`, `html`, `css` | `.ts`, `.html` |
| astro | `javascript`, `typescript`, `html`, `css` | `.astro` |

If a framework profile is inferred outside allowed applicability, producer MUST emit `USR-W-FRAMEWORK-PROFILE-INCOMPLETE` and keep profile off unless explicit override is configured.

## 26. Rollout and migration gates

Rollout decomposition:

- `docs/specs/usr-rollout-and-migration-contract.md`

USR rollout is phased and MUST pass gates in order.

Phase A (schema and registry readiness):

- add machine-readable registries
- add schema validators
- run drift checks in CI

Gate A:

- all registry and schema checks pass in CI

Phase B (dual-write):

- emit USR entities internally
- map USR to existing artifact surfaces
- keep existing behavior authoritative for external outputs

Gate B:

- deterministic parity checks between legacy outputs and USR-derived outputs pass for selected lanes

Phase C (USR-backed production path):

- switch internal derivations (symbols/edges/flow/risk) to USR-backed path
- keep legacy artifacts as compatibility outputs

Gate C:

- no regressions in core lane pass rates
- deterministic checks pass
- capability downgrade diagnostics remain within budgeted thresholds

Phase D (full conformance enforcement):

- enforce `C0` and `C1` for all languages
- enforce `C2`..`C4` based on profile requirements

Gate D:

- all required conformance levels pass in lang-full lane

## 27. Backward compatibility and deprecation policy

USR is additive during migration and MUST preserve compatibility with existing artifacts until explicit deprecation milestones are completed.

Rules:

- no removal of existing artifact fields without separate major version planning
- USR-derived replacements MUST run in shadow mode before becoming authoritative
- deprecation MUST include:
  - migration mapper
  - conformance proof
  - deterministic parity proof

Deprecation documents MUST be archived under `docs/archived/` with canonical replacements and reason metadata.

## 28. Change control policy

Changes to this spec are classified by impact tier.

Tier 1 (patch):

- clarifications without schema, taxonomy, or algorithm impact

Tier 2 (minor):

- additive enums/fields with backward-compatible defaults

Tier 3 (major):

- required field changes
- ID algorithm changes
- deterministic ordering changes
- edge endpoint contract changes

Approval requirements:

- Tier 1: one owner review
- Tier 2: two owner reviews (contracts + indexing)
- Tier 3: two owner reviews plus explicit migration plan and compatibility impact statement

Every Tier 2/Tier 3 change MUST update:

- this spec
- machine-readable registries/schemas
- conformance tests
- roadmap phase linkage tags

## 29. Extension policy

USR supports controlled extension points.

Allowed extension locations:

- `attrs`
- `extensions` (when artifact contract requires namespaced extensions)
- profile registry metadata fields

Extension rules:

- extensions MUST be namespaced
- extensions MUST NOT redefine canonical semantics of required fields
- extensions SHOULD include producer version metadata
- extensions MUST be deterministic

Forbidden extension behavior:

- changing canonical ID formation
- mutating required enum values
- bypassing endpoint constraints
- suppressing required diagnostics for downgraded capability states

## 30. Required audit artifacts and reports

Every conformance run SHOULD produce machine-readable audit artifacts.

Required report outputs:

- `usr-conformance-summary.json`
- `usr-capability-state-transitions.json`
- `usr-diagnostic-distribution.json`
- `usr-determinism-rerun-diff.json`
- `usr-profile-coverage.json`

Minimum required fields across all reports:

- `schemaVersion`
- `generatedAt`
- `runId`
- `lane`
- `buildId` (or null for non-build harness runs)
- `status`

Audit reports MUST be deterministic for identical inputs except for required timestamp fields.

## 31. Release readiness scorecard

Before enabling USR-backed production path for a lane, the following scorecard MUST pass.

- [ ] 100% registry language profile coverage
- [ ] 100% required framework profile coverage
- [ ] 0 unresolved schema drift findings
- [ ] 0 ID grammar violations
- [ ] 0 edge endpoint constraint violations
- [ ] deterministic rerun diff is empty for required entities
- [ ] capability downgrade diagnostics within approved threshold budget
- [ ] no high-severity unresolved diagnostics in required conformance levels

Any failed scorecard item blocks production-path promotion for that lane.

## 32. Strategic hardening backlog (recommended next improvements)

These items are not mandatory for `usr-1.0.0` but are high-value improvements.

- add cross-language boundary confidence calibration reports
- add per-profile false-positive tracking for risk and framework binding edges
- add fuzz-based malformed input corpus generation for parser/segment stress testing
- add long-horizon determinism checks across runtime version pins
- add contract-drift bots that open automated PRs when profile/schema divergence is detected

## 33. Diagnostic and reason-code taxonomy (normative)

Diagnostic and resolution reason codes are contract-stable and MUST be treated as API surface.

### 33.1 Diagnostic code taxonomy

All emitted diagnostics MUST use a code in this table.

| Code | Trigger | Required fields | Required remediation behavior |
| --- | --- | --- | --- |
| `USR-E-PARSER-UNAVAILABLE` | Selected parser source is not installed/usable for profile. | `phase=parse`, `languageId`, `docUid` or `segmentUid`, `capabilityImpact` includes impacted capability keys. | Producer MUST execute configured fallback chain (if any) and emit capability downgrade/loss transitions. |
| `USR-E-PARSER-FAILED` | Parser crashed, timed out, or returned invalid AST payload. | `phase=parse`, `docUid` or `segmentUid`, `message` includes parser identity/version, `range` when localized. | Producer MUST preserve previously valid segment metadata, avoid partial object corruption, and continue other segments where possible. |
| `USR-E-SEGMENT-INVALID-RANGE` | Segment or node range violates section 5/7.11 invariants. | `phase=segment`, `docUid`, `segmentUid`, `range`, `capabilityImpact` includes `ast`. | Producer MUST reject malformed entity in strict mode and MUST NOT emit dangling references to rejected entities. |
| `USR-E-SCHEMA-VIOLATION` | Entity fails schema validation (strict or configured non-strict hard checks). | `phase` for emitting stage, `message` with schema key path, `docUid` when available. | Producer MUST fail entity write path in strict mode and include violation in audit output. |
| `USR-E-CAPABILITY-LOST` | Capability transitioned from `supported`/`partial` to `unsupported`. | `phase`, `docUid`, `capabilityImpact` non-empty. | Producer MUST record deterministic downgrade/loss transition entry and block corresponding conformance assertions for that capability. |
| `USR-E-ID-GRAMMAR-VIOLATION` | Any USR ID fails section 6.7 grammar. | `phase=normalize` or `symbolize`, `message` includes field name, `docUid` if available. | Producer MUST regenerate or reject invalid IDs; strict mode MUST fail the payload. |
| `USR-E-EDGE-ENDPOINT-INVALID` | `USREdgeV1` endpoints violate section 8.5 constraints or non-resolvable refs. | `phase=relate`, `docUid` and/or `segmentUid`, `capabilityImpact` includes `relations` or `graphRelations`. | Producer MUST suppress invalid edge from resolved set and emit deterministic unresolved/suppressed representation when applicable. |
| `USR-E-RANGE-MAPPING-FAILED` | Container/virtual range mapping cannot be reconstructed for embedded/framework segments. | `phase=framework` or `segment`, `docUid`, `segmentUid`, `range` if partial mapping exists. | Producer MUST keep container entity with explicit downgrade and MUST NOT fabricate mappings. |
| `USR-E-DETERMINISM-DRIFT` | Rerun produced non-equivalent canonical serialization for identical inputs. | `phase=normalize` or `relate`, `message` includes artifact/entity class, `capabilityImpact` includes impacted surfaces. | Producer/release gate MUST fail lane promotion until drift source is corrected. |
| `USR-E-PROFILE-CONFLICT` | Language and framework profile requirements conflict for a segment/document. | `phase=framework`, `docUid`, `frameworkProfile`, `message` includes conflicting keys. | Producer MUST select deterministic precedence outcome and emit downgrade or suppression diagnostics for non-selected path. |
| `USR-E-SERIALIZATION-NONCANONICAL` | Emitted payload violates section 13.7 canonical serialization profile. | `phase=normalize`, `docUid` optional, `message` includes failing canonicalization check. | Writer MUST reserialize canonically before persistence; strict mode MUST fail write. |
| `USR-W-PARTIAL-PARSE` | Parser emitted partial tree with recoverable errors. | `phase=parse`, `docUid` or `segmentUid`, `capabilityImpact` non-empty. | Producer MUST keep valid outputs, mark affected capabilities `partial`, and include precise impacted ranges when available. |
| `USR-W-CAPABILITY-DOWNGRADED` | Capability transitioned `supported -> partial` or `unsupported -> partial`. | `phase`, `docUid`, `capabilityImpact` non-empty. | Producer MUST persist transition in capability transition artifact and attach triggering diagnostics. |
| `USR-W-FRAMEWORK-PROFILE-INCOMPLETE` | Framework overlay required signals are missing or partially derived. | `phase=framework`, `frameworkProfile`, `docUid` or `segmentUid`. | Producer MUST keep framework profile explicit, set impacted capability states to `partial`, and avoid inferred hard claims. |
| `USR-W-REFERENCE-AMBIGUOUS` | Edge/symbol reference has multiple plausible targets. | `phase=relate`, `docUid`, `attrs.resolution.status=ambiguous`, `attrs.resolution.candidates` length >= 2. | Producer MUST emit deterministic candidate list and reasonCode, and MUST NOT mark reference as resolved. |
| `USR-W-HEURISTIC-BINDING` | Resolution succeeded only via heuristic strategy below preferred parser/compiler levels. | `phase=relate` or `framework`, `docUid`, `message` contains resolver source. | Producer MUST annotate envelope resolver as `heuristic` and include confidence bounds in attrs/evidence. |
| `USR-W-TRUNCATED-FLOW` | Flow path terminated due to cap or analysis boundary. | `phase=flow` or `risk`, `docUid`, flow path references, truncation reason. | Producer MUST set `USRFlowPathV1.truncated=true` and include non-null `truncationReason`. |
| `USR-W-CANONICALIZATION-FALLBACK` | Canonical mapping required fallback from profile-specific to generic normalized kind/rule. | `phase=normalize`, `languageId`, `message` includes raw kind and mapped kind. | Producer MUST preserve raw kind and include fallback marker in attrs for review. |
| `USR-I-FALLBACK-HEURISTIC` | Fallback path chosen with valid deterministic output. | `phase`, `docUid` optional, `message` identifies chosen fallback chain. | Producer SHOULD continue pipeline and include info-level audit trace for operator visibility. |
| `USR-I-LEGACY-ADAPTER-APPLIED` | Compatibility adapter transformed legacy/alternate payload fields into canonical USR shape. | `phase=normalize` or `segment`, `message` includes adapter key/version. | Reader/writer SHOULD emit normalized output and include compatibility adapter metrics in reports. |
| `USR-I-COMPAT-MINOR-IGNORED` | Reader ignored unknown additive fields from compatible minor producer in non-strict mode. | `phase=normalize`, `message` includes ignored field keys. | Reader SHOULD continue read path and emit explicit compatibility trace event. |

### 33.2 Resolution envelope reason code taxonomy

`attrs.resolution.reasonCode` MUST be one of the following values when `status` is `unresolved` or `ambiguous`.

| Reason code | Trigger | Required envelope fields | Required remediation behavior |
| --- | --- | --- | --- |
| `USR-R-NAME-NOT-FOUND` | Target symbol/name absent in active scope/module graph. | `status=unresolved`, `targetName`, `resolver`, `candidates=[]`. | Keep unresolved edge; emit follow-up indexing/import diagnostics if module graph incomplete. |
| `USR-R-MULTIPLE-CANDIDATES` | More than one candidate has equivalent winning score. | `status=ambiguous`, `targetName`, `candidates` >= 2 sorted deterministically. | Preserve all candidates; require consumer to treat link as ambiguous and non-authoritative. |
| `USR-R-SCOPE-MISMATCH` | Candidate exists but violates lexical/module/template scope rules. | `status=unresolved` or `ambiguous`, `targetName`, candidate `why` strings. | Keep candidates only as evidence; do not emit resolved edge. |
| `USR-R-TYPE-MISMATCH` | Candidate incompatible with expected callable/type/value position. | `status=unresolved` or `ambiguous`, `targetName`, `candidates` optional. | Emit unresolved edge and preserve expected vs observed shape in notes. |
| `USR-R-MODULE-NOT-LOADED` | Dependency/module index required for resolution is unavailable. | `status=unresolved`, `targetName`, `resolver`, empty or partial candidates. | Emit capability downgrade and reattempt on next full index when dependency graph available. |
| `USR-R-DYNAMIC-DISPATCH` | Dynamic runtime dispatch prevents deterministic static binding. | `status=unresolved` or `ambiguous`, `targetName` may be null, `resolver`. | Emit unresolved/ambiguous edge with bounded confidence and risk annotations where required. |
| `USR-R-FRAMEWORK-VIRTUAL-BINDING` | Framework compiler generated binding does not map uniquely to source symbol/node. | `status=ambiguous` or `unresolved`, `frameworkProfile`, candidate provenance. | Preserve framework linkage edge with explicit ambiguity; avoid synthetic hard resolution. |
| `USR-R-ROUTE-PATTERN-CONFLICT` | Multiple route handlers normalize to same canonical route pattern. | `status=ambiguous`, `targetName` route pattern, `candidates` >= 2. | Emit route ambiguity diagnostic and require route precedence policy application. |
| `USR-R-TEMPLATE-SLOT-LATE-BIND` | Template slot/prop/event wiring resolved only at runtime composition boundary. | `status=unresolved` or `ambiguous`, `targetName`, resolver source. | Keep deterministic unresolved template edge and mark framework capability partial if required. |
| `USR-R-STYLE-SCOPE-UNKNOWN` | Style ownership/scope cannot be attached deterministically to symbol/source block. | `status=unresolved`, `targetName` may be null, empty candidates permitted. | Emit unresolved style scope edge and downgrade style capability for affected segment. |
| `USR-R-CROSS-LANG-BRIDGE-PARTIAL` | Cross-language edge (template->script, style->template, etc.) lacks complete bridge metadata. | `status=ambiguous` or `unresolved`, candidate set optional, resolver source. | Preserve partial bridge metadata and emit framework incompleteness diagnostics. |
| `USR-R-HEURISTIC-ONLY` | Resolution candidate generated only by heuristic fallback with insufficient confidence. | `status=ambiguous` or `unresolved`, `resolver=heuristic`, candidates may exist. | Keep unresolved unless confidence policy explicitly permits derived edge creation. |

Reason-code governance rules:

- New reason codes are Tier 2 changes at minimum under section 28.
- Producers MUST NOT emit free-form reason codes in strict mode.
- Readers in non-strict mode MAY preserve unknown reason codes only under compatibility adapters and MUST emit `USR-I-COMPAT-MINOR-IGNORED`.

### 33.3 Field-level diagnostic contract requirements

To keep diagnostics machine-actionable across languages/frameworks, the following field requirements are mandatory.

| Field | Requirement | Validation rule |
| --- | --- | --- |
| `code` | MUST be listed in section 33.1. | strict readers reject unknown values with `USR-E-SCHEMA-VIOLATION`. |
| `severity` | MUST match code family prefix (`E`, `W`, `I`). | mismatch is a schema violation. |
| `phase` | MUST be one of the allowed phase enum values from section 7.9. | unknown phase is a schema violation. |
| `message` | MUST be non-empty, deterministic for same root cause class, and SHOULD include parser/framework identifier when relevant. | empty messages are rejected in strict mode. |
| `capabilityImpact` | MUST be non-empty for downgrade/loss and parser/schema failures. | empty list invalid for codes in families `USR-E-CAPABILITY-*`, `USR-W-CAPABILITY-*`, parser failure classes. |
| `docUid` / `segmentUid` / `nodeUid` | MUST include the narrowest available scope for localization. | if narrower scope exists but omitted, emit `USR-W-CANONICALIZATION-FALLBACK` on producer side. |

Localization preference order:

1. `nodeUid` + `range`
2. `segmentUid` + `range`
3. `docUid` only

Producers MUST choose the highest-fidelity localization available at emission time.

### 33.4 Remediation class taxonomy

Each diagnostic code family MUST map to one remediation class so CI and operational tooling can route ownership deterministically.

| Remediation class | Applicable codes | Blocking behavior | Owner role |
| --- | --- | --- | --- |
| `parser-runtime` | `USR-E-PARSER-UNAVAILABLE`, `USR-E-PARSER-FAILED`, `USR-W-PARTIAL-PARSE` | blocking for strict lanes if capability requirement is `supported` | parser/integration owner |
| `schema-contract` | `USR-E-SCHEMA-VIOLATION`, `USR-E-ID-GRAMMAR-VIOLATION`, `USR-E-SERIALIZATION-NONCANONICAL` | always blocking in strict mode | contracts owner |
| `graph-integrity` | `USR-E-EDGE-ENDPOINT-INVALID`, `USR-W-REFERENCE-AMBIGUOUS`, `USR-W-HEURISTIC-BINDING` | blocking when conformance target requires resolved relations | indexing/graph owner |
| `framework-overlay` | `USR-E-PROFILE-CONFLICT`, `USR-W-FRAMEWORK-PROFILE-INCOMPLETE`, framework resolution reason codes | blocking for C4-required lanes | framework profile owner |
| `capability-state` | `USR-E-CAPABILITY-LOST`, `USR-W-CAPABILITY-DOWNGRADED` | blocking if transition violates declared lane policy | conformance owner |
| `analysis-caps` | `USR-W-TRUNCATED-FLOW`, `USR-W-CANONICALIZATION-FALLBACK`, `USR-I-FALLBACK-HEURISTIC` | non-blocking by default; tracked against budget | analysis owner |

## 34. Canonical JSON examples (normative reference)

The examples in this section are canonical references for schema shape, deterministic ordering, and minimum required field sets.

Rules:

- Every example is valid JSON with explicit nulls where applicable.
- Minimal examples represent the smallest valid object expected in strict mode.
- Maximal typical examples represent common high-fidelity payloads, not absolute maxima.
- Producers MAY include additional fields only where extension policy allows (section 29).

### 34.1 `USRDocumentV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "docUid": "doc64:v1:1a2b3c4d5e6f7788",
  "namespaceKey": "repo:main",
  "fileRelPath": "src/main.ts",
  "virtualPath": "src/main.ts",
  "containerExt": null,
  "containerLanguageId": null,
  "effectiveLanguageId": "typescript",
  "parserLanguageId": "typescript",
  "encoding": "utf-8",
  "textHash": {
    "algo": "xxh64",
    "value": "9f01aa22bb33cc44"
  },
  "segmentUid": null,
  "segmentKind": "file",
  "frameworkProfiles": [],
  "capabilities": {
    "imports": "supported",
    "relations": "supported",
    "docmeta": "supported",
    "ast": "supported",
    "controlFlow": "partial",
    "dataFlow": "partial",
    "graphRelations": "supported",
    "riskLocal": "partial",
    "riskInterprocedural": "unsupported",
    "symbolGraph": "supported"
  },
  "diagnostics": [],
  "provenance": {
    "buildId": null,
    "mode": "code",
    "parserRuntime": "tree-sitter-typescript@0.23.2",
    "registrySignature": "lang-registry:sha256:1111",
    "generatedAt": "2026-02-10T01:00:00Z"
  }
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "docUid": "doc64:v1:9abcdeff00112233",
  "namespaceKey": "repo:webapp",
  "fileRelPath": "apps/web/src/pages/index.vue",
  "virtualPath": "apps/web/src/pages/index.vue#template",
  "containerExt": ".vue",
  "containerLanguageId": "vue",
  "effectiveLanguageId": "html",
  "parserLanguageId": "html",
  "encoding": "utf-8",
  "textHash": {
    "algo": "sha1",
    "value": "7c4f98efb6b0aa77c8f7a1112233445566778899"
  },
  "segmentUid": "segu:v1:33445566778899aa",
  "segmentKind": "template",
  "frameworkProfiles": [
    "vue"
  ],
  "capabilities": {
    "imports": "partial",
    "relations": "supported",
    "docmeta": "supported",
    "ast": "supported",
    "controlFlow": "partial",
    "dataFlow": "unsupported",
    "graphRelations": "supported",
    "riskLocal": "partial",
    "riskInterprocedural": "unsupported",
    "symbolGraph": "partial"
  },
  "diagnostics": [
    "diag64:v1:aa00bb11cc22dd33"
  ],
  "provenance": {
    "buildId": "build-2026-02-10T01:00:00Z",
    "mode": "code",
    "parserRuntime": "vue-compiler-sfc@3.5.0",
    "registrySignature": "lang-registry:sha256:2222",
    "generatedAt": "2026-02-10T01:00:00Z"
  }
}
```

### 34.2 `USRSegmentV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "segmentUid": "segu:v1:00aa11bb22cc33dd",
  "segmentId": null,
  "parentSegmentUid": null,
  "docUid": "doc64:v1:1a2b3c4d5e6f7788",
  "kind": "code",
  "containerRange": {
    "start": 0,
    "end": 42,
    "startLine": 1,
    "endLine": 3,
    "startCol": 1,
    "endCol": 5
  },
  "virtualRange": {
    "start": 0,
    "end": 42,
    "startLine": 1,
    "endLine": 3,
    "startCol": 1,
    "endCol": 5
  },
  "effectiveExt": ".ts",
  "effectiveLanguageId": "typescript",
  "parserLanguageId": "typescript",
  "frameworkProfile": null,
  "extraction": {
    "method": "tree-sitter",
    "confidence": 1.0,
    "partial": false
  },
  "textHash": {
    "algo": "xxh64",
    "value": "0011223344556677"
  },
  "flags": {
    "synthetic": false,
    "generated": false,
    "minified": false
  },
  "diagnostics": []
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "segmentUid": "segu:v1:1122334455667788",
  "segmentId": "legacy:range:src/pages/index.vue:template:3-120",
  "parentSegmentUid": "segu:v1:aabbccddeeff0011",
  "docUid": "doc64:v1:9abcdeff00112233",
  "kind": "template",
  "containerRange": {
    "start": 210,
    "end": 1180,
    "startLine": 10,
    "endLine": 62,
    "startCol": 1,
    "endCol": 12
  },
  "virtualRange": {
    "start": 0,
    "end": 970,
    "startLine": 1,
    "endLine": 52,
    "startCol": 1,
    "endCol": 12
  },
  "effectiveExt": ".vue.html",
  "effectiveLanguageId": "html",
  "parserLanguageId": "html",
  "frameworkProfile": "vue",
  "extraction": {
    "method": "framework-compiler",
    "confidence": 0.98,
    "partial": true
  },
  "textHash": {
    "algo": "xxh64",
    "value": "8899aabbccddeeff"
  },
  "flags": {
    "synthetic": true,
    "generated": false,
    "minified": false
  },
  "diagnostics": [
    "diag64:v1:aa00bb11cc22dd33",
    "diag64:v1:aa00bb11cc22dd44"
  ]
}
```

### 34.3 `USRNodeV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "nodeUid": "n64:v1:0123456789abcdef",
  "docUid": "doc64:v1:1a2b3c4d5e6f7788",
  "segmentUid": "segu:v1:00aa11bb22cc33dd",
  "parentNodeUid": null,
  "rawKind": "function_declaration",
  "normKind": "function_decl",
  "category": "callable",
  "containerRange": {
    "start": 0,
    "end": 24,
    "startLine": 1,
    "endLine": 1,
    "startCol": 1,
    "endCol": 24
  },
  "virtualRange": {
    "start": 0,
    "end": 24,
    "startLine": 1,
    "endLine": 1,
    "startCol": 1,
    "endCol": 24
  },
  "textHash": {
    "algo": "xxh64",
    "value": "1234567890abcdef"
  },
  "flags": [],
  "attrs": {},
  "parser": {
    "source": "tree-sitter",
    "languageId": "typescript",
    "grammar": "tree-sitter-typescript",
    "version": "0.23.2"
  },
  "diagnostics": []
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "nodeUid": "n64:v1:fedcba9876543210",
  "docUid": "doc64:v1:9abcdeff00112233",
  "segmentUid": "segu:v1:1122334455667788",
  "parentNodeUid": "n64:v1:10101010aabbccdd",
  "rawKind": "VElement",
  "normKind": "template_element",
  "category": "template",
  "containerRange": {
    "start": 262,
    "end": 340,
    "startLine": 13,
    "endLine": 16,
    "startCol": 3,
    "endCol": 8
  },
  "virtualRange": {
    "start": 52,
    "end": 130,
    "startLine": 4,
    "endLine": 7,
    "startCol": 3,
    "endCol": 8
  },
  "textHash": {
    "algo": "xxh64",
    "value": "9988776655443322"
  },
  "flags": [
    "framework-generated-attrs",
    "binds-runtime-event"
  ],
  "attrs": {
    "tagName": "UserCard",
    "namespace": "html",
    "slot": "default"
  },
  "parser": {
    "source": "framework-compiler",
    "languageId": "html",
    "grammar": "vue-template-ast",
    "version": "3.5.0"
  },
  "diagnostics": [
    "diag64:v1:aa00bb11cc22dd33"
  ]
}
```

### 34.4 `USRSymbolV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "symbolUid": "symu:v1:typescript:src/main.ts:alphaone",
  "symbolId": null,
  "scopedId": null,
  "symbolKey": "typescript::src/main.ts::alphaOne",
  "signatureKey": null,
  "languageId": "typescript",
  "kind": "function",
  "kindGroup": "callable",
  "name": "alphaOne",
  "qualifiedName": "alphaOne",
  "declarationNodeUid": "n64:v1:0123456789abcdef",
  "declarationDocUid": "doc64:v1:1a2b3c4d5e6f7788",
  "declarationSegmentUid": "segu:v1:00aa11bb22cc33dd",
  "exported": false,
  "visibility": "unknown",
  "modifiers": [],
  "frameworkRole": "none",
  "types": {},
  "diagnostics": []
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "symbolUid": "symu:v1:vue:apps/web/src/pages/index.vue:usercard",
  "symbolId": "legacy-symbol-id:user-card",
  "scopedId": "vue::component::index.vue::UserCard",
  "symbolKey": "vue::apps/web/src/pages/index.vue::UserCard",
  "signatureKey": "UserCard(props:UserCardProps):VNode",
  "languageId": "typescript",
  "kind": "class",
  "kindGroup": "type",
  "name": "UserCard",
  "qualifiedName": "components.UserCard",
  "declarationNodeUid": "n64:v1:fedcba9876543210",
  "declarationDocUid": "doc64:v1:9abcdeff00112233",
  "declarationSegmentUid": "segu:v1:33445566778899aa",
  "exported": true,
  "visibility": "public",
  "modifiers": [
    "default",
    "framework:component"
  ],
  "frameworkRole": "component",
  "types": {
    "declared": {
      "returns": [
        {
          "type": "VNode",
          "source": "declared",
          "confidence": 1.0,
          "shape": "named"
        }
      ],
      "params": {
        "props": [
          {
            "type": "UserCardProps",
            "source": "declared",
            "confidence": 1.0,
            "shape": "named"
          }
        ]
      }
    },
    "inferred": {
      "fields": {
        "isLoading": [
          {
            "type": "boolean",
            "source": "inferred",
            "confidence": 0.98,
            "shape": "primitive"
          }
        ]
      }
    }
  },
  "diagnostics": [
    "diag64:v1:aa00bb11cc22dd55"
  ]
}
```

### 34.5 `USREdgeV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "edgeUid": "edge64:v1:0011aa22bb33cc44",
  "kind": "references",
  "source": {
    "entity": "node",
    "uid": "n64:v1:0123456789abcdef"
  },
  "target": {
    "entity": "symbol",
    "uid": "symu:v1:typescript:src/main.ts:alphaone"
  },
  "languageId": "typescript",
  "frameworkProfile": null,
  "status": "resolved",
  "confidence": 1.0,
  "containerRange": {
    "start": 30,
    "end": 38,
    "startLine": 2,
    "endLine": 2,
    "startCol": 10,
    "endCol": 18
  },
  "virtualRange": {
    "start": 30,
    "end": 38,
    "startLine": 2,
    "endLine": 2,
    "startCol": 10,
    "endCol": 18
  },
  "attrs": {},
  "evidence": {
    "source": "parser"
  },
  "diagnostics": []
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "edgeUid": "edge64:v1:55aa66bb77cc88dd",
  "kind": "template_binds",
  "source": {
    "entity": "node",
    "uid": "n64:v1:fedcba9876543210"
  },
  "target": {
    "entity": "symbol",
    "uid": "symu:v1:vue:apps/web/src/pages/index.vue:usercard"
  },
  "languageId": "html",
  "frameworkProfile": "vue",
  "status": "ambiguous",
  "confidence": 0.74,
  "containerRange": {
    "start": 280,
    "end": 312,
    "startLine": 14,
    "endLine": 14,
    "startCol": 7,
    "endCol": 39
  },
  "virtualRange": {
    "start": 70,
    "end": 102,
    "startLine": 5,
    "endLine": 5,
    "startCol": 7,
    "endCol": 39
  },
  "attrs": {
    "bindingKind": "prop",
    "bindingName": "user",
    "resolution": {
      "status": "ambiguous",
      "targetName": "user",
      "resolver": "framework-compiler",
      "reasonCode": "USR-R-MULTIPLE-CANDIDATES",
      "candidates": [
        {
          "uid": "symu:v1:typescript:apps/web/src/stores/user.ts:state",
          "entity": "symbol",
          "confidence": 0.74,
          "why": "store state alias in setup scope"
        },
        {
          "uid": "symu:v1:typescript:apps/web/src/pages/index.vue:props.user",
          "entity": "symbol",
          "confidence": 0.74,
          "why": "prop destructure in script setup"
        }
      ]
    }
  },
  "evidence": {
    "source": "compiler",
    "notes": [
      "v-bind:user expression resolved from merged setup scope"
    ]
  },
  "diagnostics": [
    "diag64:v1:aa00bb11cc22dd66"
  ]
}
```

### 34.6 `USRFlowPathV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "pathUid": "path64:v1:1111222233334444",
  "flowKind": "control",
  "languageId": "typescript",
  "nodeRefs": [],
  "edgeRefs": [],
  "truncated": false,
  "truncationReason": null,
  "confidence": 1.0,
  "diagnostics": []
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "pathUid": "path64:v1:aaaabbbbccccdddd",
  "flowKind": "risk",
  "languageId": "typescript",
  "nodeRefs": [
    {
      "entity": "node",
      "uid": "n64:v1:10101010aabbccdd"
    },
    {
      "entity": "node",
      "uid": "n64:v1:20202020aabbccdd"
    },
    {
      "entity": "node",
      "uid": "n64:v1:30303030aabbccdd"
    }
  ],
  "edgeRefs": [
    "edge64:v1:a1a1a1a1b2b2b2b2",
    "edge64:v1:c3c3c3c3d4d4d4d4"
  ],
  "truncated": true,
  "truncationReason": "max-hop-cap:32",
  "confidence": 0.82,
  "diagnostics": [
    "diag64:v1:aa00bb11cc22dd77"
  ]
}
```

### 34.7 `USRRouteV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "routeUid": "route64:v1:0102030405060708",
  "framework": "next",
  "pattern": "/",
  "file": "apps/web/src/app/page.tsx",
  "segmentUid": null,
  "symbolUid": null,
  "method": null,
  "runtimeSide": "universal",
  "attrs": {}
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "routeUid": "route64:v1:8899aabbccddeeff",
  "framework": "nuxt",
  "pattern": "/users/[id]",
  "file": "apps/web/pages/users/[id].vue",
  "segmentUid": "segu:v1:77889900aabbccdd",
  "symbolUid": "symu:v1:vue:apps/web/pages/users/[id].vue:default",
  "method": "GET",
  "runtimeSide": "server",
  "attrs": {
    "routeName": "users-id",
    "middleware": [
      "auth",
      "audit"
    ],
    "priority": 120
  }
}
```

### 34.8 `USRStyleScopeV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "scopeUid": "scope64:v1:1111aaaabbbb2222",
  "framework": "none",
  "scopeType": "global",
  "segmentUid": null,
  "ownerSymbolUid": null,
  "selectorHashes": [],
  "attrs": {}
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "scopeUid": "scope64:v1:3333ccccdddd4444",
  "framework": "vue",
  "scopeType": "scoped",
  "segmentUid": "segu:v1:44556677889900aa",
  "ownerSymbolUid": "symu:v1:vue:apps/web/src/components/user-card.vue:usercard",
  "selectorHashes": [
    "xxh64:2f0037bb77cc00dd",
    "xxh64:98aa76cc55bb1100"
  ],
  "attrs": {
    "scopeToken": "data-v-7f2a9912",
    "containsDeepSelector": true
  }
}
```

### 34.9 `USRDiagnosticV1`

Minimal valid:

```json
{
  "schemaVersion": "usr-1.0.0",
  "diagnosticUid": "diag64:v1:0101010102020202",
  "code": "USR-W-PARTIAL-PARSE",
  "severity": "warning",
  "phase": "parse",
  "message": "Recovered parse with inserted missing token.",
  "languageId": "typescript",
  "frameworkProfile": null,
  "docUid": "doc64:v1:1a2b3c4d5e6f7788",
  "segmentUid": "segu:v1:00aa11bb22cc33dd",
  "nodeUid": null,
  "range": null,
  "capabilityImpact": [
    "ast"
  ]
}
```

Maximal typical:

```json
{
  "schemaVersion": "usr-1.0.0",
  "diagnosticUid": "diag64:v1:9999aaaabbbbcccc",
  "code": "USR-W-REFERENCE-AMBIGUOUS",
  "severity": "warning",
  "phase": "relate",
  "message": "Reference 'user' matched multiple framework scope candidates.",
  "languageId": "html",
  "frameworkProfile": "vue",
  "docUid": "doc64:v1:9abcdeff00112233",
  "segmentUid": "segu:v1:1122334455667788",
  "nodeUid": "n64:v1:fedcba9876543210",
  "range": {
    "start": 280,
    "end": 312,
    "startLine": 14,
    "endLine": 14,
    "startCol": 7,
    "endCol": 39
  },
  "capabilityImpact": [
    "relations",
    "symbolGraph"
  ]
}
```

### 34.10 Cross-entity coherence requirements for canonical example bundles

When example entities are emitted as one bundle (single test fixture or artifact unit), the following references MUST resolve:

| Source entity field | Target entity type | Constraint |
| --- | --- | --- |
| `USRSegmentV1.docUid` | `USRDocumentV1` | MUST resolve to an existing `docUid` in bundle scope. |
| `USRNodeV1.docUid` | `USRDocumentV1` | MUST resolve to existing `docUid`. |
| `USRNodeV1.segmentUid` | `USRSegmentV1` | if non-null, MUST resolve to existing `segmentUid`. |
| `USRSymbolV1.declarationNodeUid` | `USRNodeV1` | if non-null, MUST resolve to existing `nodeUid`. |
| `USRSymbolV1.declarationDocUid` | `USRDocumentV1` | MUST resolve to existing `docUid`. |
| `USREdgeV1.source`/`target` | Entity by `USRRef.entity` | MUST resolve and satisfy endpoint constraints from section 8.5. |
| `USRFlowPathV1.nodeRefs` | `USRNodeV1` or `USRSymbolV1` | each ref MUST resolve; order MUST be deterministic path order. |
| `USRFlowPathV1.edgeRefs` | `USREdgeV1` | each edge UID MUST resolve. |
| `USRRouteV1.segmentUid` | `USRSegmentV1` | if non-null, MUST resolve to route-owning segment. |
| `USRRouteV1.symbolUid` | `USRSymbolV1` | if non-null, MUST resolve to route handler/page/layout symbol. |
| `USRStyleScopeV1.segmentUid` | `USRSegmentV1` | if non-null, MUST resolve to style-bearing segment. |
| `USRStyleScopeV1.ownerSymbolUid` | `USRSymbolV1` | if non-null, MUST resolve to style owner symbol. |
| `USRDiagnosticV1.segmentUid` / `nodeUid` | `USRSegmentV1` / `USRNodeV1` | if present, both MUST resolve. |

A canonical example fixture SHOULD include one fully linked bundle covering all entity families to validate end-to-end coherence.

### 34.11 Canonical example validation checklist

Every canonical example bundle used in tests/docs MUST pass all checks below:

- JSON parses without lossy transforms (no comments, no duplicate keys).
- All IDs satisfy section 6.7 grammar for their entity class.
- `schemaVersion` is exactly `usr-1.0.0`.
- Array ordering is deterministic and repeatable (section 13 tie-breakers).
- `confidence` values are normalized numeric values in `[0,1]` or null where allowed.
- Required reference fields resolve under section 34.10 constraints.
- Diagnostic code/severity pairs satisfy section 33 rules.
- Canonical serialization output hash is stable across two reruns in the same fixture harness.

Validation evidence for each canonical example update MUST include:

- validator run artifact
- deterministic rerun diff artifact
- explicit list of changed example IDs and fields

## 35. Per-framework edge canonicalization examples (normative)

This section defines canonical edge construction patterns for framework route/template/style semantics.

### 35.1 Canonicalization rules (applies to all framework examples)

- `route_maps_to` MUST represent normalized route pattern to handler/layout/page symbols.
- `template_binds` MUST represent data/prop/event binding relationships across template and script surfaces.
- `style_scopes` MUST represent style ownership/scope attachment from style/template segments or nodes to owning symbols.
- All examples below are normative in structure, field naming, and edge kind selection.
- Example payloads are canonical edge snippets. Full edge objects MUST still satisfy `USREdgeV1` fields and constraints from sections 7.5, 7.11, and 8.5.

Canonical attrs key requirements by edge family:

| Edge kind | Required attrs keys | Optional attrs keys (common) | Forbidden canonicalization behavior |
| --- | --- | --- | --- |
| `route_maps_to` | `routePattern`, `router` | `routeName`, `routeSource`, `segmentType`, `routeFileKind`, `runtimeSide`, `priority` | Emitting framework-native route token only without canonical `routePattern`. |
| `template_binds` | `bindingKind`, `bindingName` | `directive`, `eventSyntax`, `expressionKind`, `origin`, `runtimeSide`, `islandBoundary` | Folding template binding into generic `references` edge. |
| `style_scopes` | `scopeType`, `styleSystem` | `scopeToken`, `encapsulation`, `token`, `file`, `globalEscape`, `deepSelectorMode` | Omitting scope edge when style block exists but owner is known. |

### 35.2 React (`frameworkProfile=react`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "react",
    "source": { "entity": "node", "uid": "n64:v1:1111111111110001" },
    "target": { "entity": "symbol", "uid": "symu:v1:react:src/app.tsx:dashboardpage" },
    "attrs": { "routePattern": "/dashboard", "router": "react-router", "routeSource": "jsx-route-element" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "react",
    "source": { "entity": "node", "uid": "n64:v1:1111111111110002" },
    "target": { "entity": "symbol", "uid": "symu:v1:react:src/components/usercard.tsx:user" },
    "attrs": { "bindingKind": "prop", "bindingName": "user", "expressionKind": "jsx-expression-container" }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "react",
    "source": { "entity": "segment", "uid": "segu:v1:1111111111110003" },
    "target": { "entity": "symbol", "uid": "symu:v1:react:src/components/usercard.tsx:usercard" },
    "attrs": { "scopeType": "module", "styleSystem": "css-modules", "token": "styles.userCard" }
  }
]
```

### 35.3 Vue (`frameworkProfile=vue`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "vue",
    "source": { "entity": "node", "uid": "n64:v1:2222222222220001" },
    "target": { "entity": "symbol", "uid": "symu:v1:vue:src/router/index.ts:userdetails" },
    "attrs": { "routePattern": "/users/[id]", "router": "vue-router", "routeName": "user-details" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "vue",
    "source": { "entity": "node", "uid": "n64:v1:2222222222220002" },
    "target": { "entity": "symbol", "uid": "symu:v1:typescript:src/pages/users/[id].vue:userid" },
    "attrs": { "bindingKind": "directive", "directive": "v-model", "bindingName": "userId" }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "vue",
    "source": { "entity": "segment", "uid": "segu:v1:2222222222220003" },
    "target": { "entity": "symbol", "uid": "symu:v1:vue:src/pages/users/[id].vue:default" },
    "attrs": { "scopeType": "scoped", "scopeToken": "data-v-7f2a9912", "deepSelectorMode": "combinator" }
  }
]
```

### 35.4 Next.js (`frameworkProfile=next`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "next",
    "source": { "entity": "node", "uid": "n64:v1:3333333333330001" },
    "target": { "entity": "document", "uid": "doc64:v1:3333333333330004" },
    "attrs": { "routePattern": "/blog/[slug]", "router": "app-router", "segmentType": "page" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "next",
    "source": { "entity": "node", "uid": "n64:v1:3333333333330002" },
    "target": { "entity": "symbol", "uid": "symu:v1:next:src/app/blog/[slug]/page.tsx:params" },
    "attrs": { "bindingKind": "prop", "bindingName": "params.slug", "runtimeSide": "server" }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "next",
    "source": { "entity": "segment", "uid": "segu:v1:3333333333330003" },
    "target": { "entity": "symbol", "uid": "symu:v1:next:src/app/blog/[slug]/page.tsx:page" },
    "attrs": { "scopeType": "module", "styleSystem": "css-modules", "file": "page.module.css" }
  }
]
```

### 35.5 Nuxt (`frameworkProfile=nuxt`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "nuxt",
    "source": { "entity": "node", "uid": "n64:v1:4444444444440001" },
    "target": { "entity": "symbol", "uid": "symu:v1:nuxt:pages/users/[id].vue:default" },
    "attrs": { "routePattern": "/users/[id]", "router": "file-system", "routeName": "users-id" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "nuxt",
    "source": { "entity": "node", "uid": "n64:v1:4444444444440002" },
    "target": { "entity": "symbol", "uid": "symu:v1:nuxt:pages/users/[id].vue:useRoute" },
    "attrs": { "bindingKind": "composable", "bindingName": "route.params.id", "origin": "script-setup" }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "nuxt",
    "source": { "entity": "segment", "uid": "segu:v1:4444444444440003" },
    "target": { "entity": "symbol", "uid": "symu:v1:nuxt:pages/users/[id].vue:default" },
    "attrs": { "scopeType": "scoped", "scopeToken": "data-v-a1122334", "styleSystem": "sfc-style" }
  }
]
```

### 35.6 Svelte (`frameworkProfile=svelte`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "svelte",
    "source": { "entity": "node", "uid": "n64:v1:5555555555550001" },
    "target": { "entity": "symbol", "uid": "symu:v1:svelte:src/App.svelte:default" },
    "attrs": { "routePattern": "/", "router": "custom-or-none", "routeSource": "manual-map" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "svelte",
    "source": { "entity": "node", "uid": "n64:v1:5555555555550002" },
    "target": { "entity": "symbol", "uid": "symu:v1:svelte:src/lib/UserCard.svelte:user" },
    "attrs": { "bindingKind": "directive", "directive": "bind:value", "bindingName": "user" }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "svelte",
    "source": { "entity": "segment", "uid": "segu:v1:5555555555550003" },
    "target": { "entity": "symbol", "uid": "symu:v1:svelte:src/lib/UserCard.svelte:default" },
    "attrs": { "scopeType": "scoped", "scopeToken": "svelte-1a2b3c", "styleSystem": "compiled-scoping" }
  }
]
```

### 35.7 SvelteKit (`frameworkProfile=sveltekit`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "sveltekit",
    "source": { "entity": "node", "uid": "n64:v1:6666666666660001" },
    "target": { "entity": "document", "uid": "doc64:v1:6666666666660004" },
    "attrs": { "routePattern": "/products/[sku]", "router": "file-system", "routeFileKind": "+page.svelte" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "sveltekit",
    "source": { "entity": "node", "uid": "n64:v1:6666666666660002" },
    "target": { "entity": "symbol", "uid": "symu:v1:sveltekit:src/routes/products/[sku]/+page.ts:load" },
    "attrs": { "bindingKind": "data-prop", "bindingName": "data.product", "origin": "load-return" }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "sveltekit",
    "source": { "entity": "segment", "uid": "segu:v1:6666666666660003" },
    "target": { "entity": "symbol", "uid": "symu:v1:sveltekit:src/routes/products/[sku]/+page.svelte:default" },
    "attrs": { "scopeType": "scoped", "scopeToken": "svelte-7f8e9d", "styleSystem": "compiled-scoping" }
  }
]
```

### 35.8 Angular (`frameworkProfile=angular`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "angular",
    "source": { "entity": "node", "uid": "n64:v1:7777777777770001" },
    "target": { "entity": "symbol", "uid": "symu:v1:angular:src/app/users/users.component.ts:UsersComponent" },
    "attrs": { "routePattern": "users/[id]", "router": "@angular/router", "routeSource": "Route[] config" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "angular",
    "source": { "entity": "node", "uid": "n64:v1:7777777777770002" },
    "target": { "entity": "symbol", "uid": "symu:v1:angular:src/app/users/users.component.ts:userId" },
    "attrs": { "bindingKind": "template-binding", "directive": "ngModel", "bindingName": "userId" }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "angular",
    "source": { "entity": "segment", "uid": "segu:v1:7777777777770003" },
    "target": { "entity": "symbol", "uid": "symu:v1:angular:src/app/users/users.component.ts:UsersComponent" },
    "attrs": { "scopeType": "shadow", "encapsulation": "ViewEncapsulation.Emulated", "styleSystem": "component-styles" }
  }
]
```

### 35.9 Astro (`frameworkProfile=astro`)

```json
[
  {
    "kind": "route_maps_to",
    "frameworkProfile": "astro",
    "source": { "entity": "node", "uid": "n64:v1:8888888888880001" },
    "target": { "entity": "document", "uid": "doc64:v1:8888888888880004" },
    "attrs": { "routePattern": "/docs/[...slug]", "router": "file-system", "routeFileKind": ".astro page" }
  },
  {
    "kind": "template_binds",
    "frameworkProfile": "astro",
    "source": { "entity": "node", "uid": "n64:v1:8888888888880002" },
    "target": { "entity": "symbol", "uid": "symu:v1:astro:src/pages/docs/[...slug].astro:Astro.params.slug" },
    "attrs": { "bindingKind": "frontmatter-binding", "bindingName": "Astro.params.slug", "islandBoundary": false }
  },
  {
    "kind": "style_scopes",
    "frameworkProfile": "astro",
    "source": { "entity": "segment", "uid": "segu:v1:8888888888880003" },
    "target": { "entity": "symbol", "uid": "symu:v1:astro:src/pages/docs/[...slug].astro:default" },
    "attrs": { "scopeType": "scoped", "styleSystem": "scoped-by-default", "globalEscape": ":global" }
  }
]
```

### 35.10 Cross-framework canonicalization constraints

- Dynamic route placeholders MUST canonicalize to bracket form in `routePattern` (`[id]`, `[...slug]`) regardless of source syntax (`:id`, regex form, etc.).
- Template event bindings MUST canonicalize into `template_binds` with `attrs.bindingKind` and `attrs.bindingName`; framework-native event tokens stay in `attrs.directive` or `attrs.eventSyntax`.
- Style scoping MUST canonicalize to `attrs.scopeType` values: `global`, `module`, `scoped`, `shadow`, or `unknown`.
- If canonical route/template/style mapping cannot be completed, producer MUST emit unresolved/ambiguous edges and include section 33 reason codes.

### 35.11 Framework-specific edge-case canonicalization checklist

The following edge cases are mandatory for profile conformance and MUST be represented in fixtures and expected outputs.

| Framework | Route edge edge cases | Template edge edge cases | Style edge edge cases |
| --- | --- | --- | --- |
| `react` | nested route trees, lazy route elements, wildcard fallback routes | prop spread, hook-returned state binding, callback prop/event passthrough | CSS modules aliasing, CSS-in-JS class token synthesis, global stylesheet fallback |
| `vue` | named routes with aliases/redirects, dynamic param + optional param routes | `v-model` modifiers, slot prop forwarding, `v-for` alias shadowing | scoped + deep selectors, module + scoped coexistence, `:global` escapes |
| `next` | app router segment groups, parallel routes, route handlers by HTTP verb | server/client component boundary props, async server data bindings, dynamic params in layouts | module css per segment, global css from app root, styled-jsx fallbacks |
| `nuxt` | file-system route conflicts, route rules/middleware overlays, optional/catch-all params | `useAsyncData` and `useRoute` bindings, auto-imported composables, slot forwarding | scoped SFC styles, module imports in SFC, global app style injection |
| `svelte` | custom router integrations, fallback route resolution, dynamic segment params | `bind:` directives, store auto-subscription `$store`, slot prop forwarding | compiled scoped selectors, global escapes, style directives from preprocessors |
| `sveltekit` | `+page`/`+layout` precedence, endpoint + page collisions, catch-all routing | `load` data propagation, form actions, page data shadowing in nested layouts | scoped style compilation across nested layouts, global stylesheet leakage checks |
| `angular` | nested `Route[]` with lazy modules, guards/redirects, outlet-named routes | structural directives (`*ngIf`, `*ngFor`), banana-in-a-box bindings, signal/computed bindings | emulated vs shadow encapsulation, component styleUrls arrays, global stylesheet overrides |
| `astro` | static + dynamic route mixing, rest parameter routes, content-collection route generation | frontmatter to template data, framework island prop bridges, slot passthrough | scoped default css, `:global` usage, island framework style boundary crossing |

## 36. Mandatory backward-compatibility test matrix (normative)

Backward compatibility for USR is release-blocking. The matrix below is the minimum mandatory scenario set.

### 36.1 Producer/reader compatibility matrix

| Scenario ID | Producer schemaVersion | Reader supported versions | Reader mode | Input shape | Expected result | Required diagnostics/events |
| --- | --- | --- | --- | --- | --- | --- |
| `BC-001` | `usr-1.0.0` | `usr-1.0.0` | strict | canonical minimal payloads only | accept | none |
| `BC-002` | `usr-1.0.0` | `usr-1.0.0` | strict | canonical maximal typical payloads | accept | none |
| `BC-003` | `usr-1.0.0` | `usr-1.0.0` | strict | payload with unknown top-level fields | reject | `USR-E-SCHEMA-VIOLATION` |
| `BC-004` | `usr-1.0.0` | `usr-1.0.0` | non-strict | payload with additive namespaced extension fields | accept with adapter | `USR-I-LEGACY-ADAPTER-APPLIED` |
| `BC-005` | `usr-1.0.0` | `usr-1.1.x` | strict | base 1.0 payload | accept | none |
| `BC-006` | `usr-1.1.x` | `usr-1.0.0` | strict | payload includes new minor fields not known to 1.0 reader | reject | `USR-E-SCHEMA-VIOLATION` |
| `BC-007` | `usr-1.1.x` | `usr-1.0.0` | non-strict | payload includes additive fields only | accept with ignored fields | `USR-I-COMPAT-MINOR-IGNORED` |
| `BC-008` | `usr-2.0.0` | `usr-1.0.0` | strict | payload with breaking major semantics | reject | compatibility error plus `USR-E-SCHEMA-VIOLATION` |
| `BC-009` | `usr-1.0.0` | `usr-1.0.0` | strict | payload has legacy IDs not matching 6.7 grammar | reject | `USR-E-ID-GRAMMAR-VIOLATION` |
| `BC-010` | `usr-1.0.0` | `usr-1.0.0` | strict | payload has unknown diagnostic reason code | reject | `USR-E-SCHEMA-VIOLATION` |
| `BC-011` | `usr-1.0.0` | `usr-1.0.0` | non-strict | payload has unknown reason code with adapter enabled | accept with warning | `USR-I-COMPAT-MINOR-IGNORED` |
| `BC-012` | `usr-1.0.0` | `usr-1.0.0` | strict | canonical serialization keys reordered or non-normalized numbers | reject | `USR-E-SERIALIZATION-NONCANONICAL` |

### 36.2 Mandatory fixture families

The compatibility matrix MUST be executed against all of the following fixture families:

- plain source language fixtures (single-language, non-framework)
- embedded/multi-segment fixtures (`.vue`, `.svelte`, `.astro`, Angular template+style pairs)
- cross-language binding fixtures (template-script-style bridges)
- degraded capability fixtures (forced parser fallback and partial parse)
- extension/adaptation fixtures (known additive fields with namespaced keys)

### 36.3 Mandatory CI execution policy

- Compatibility matrix scenarios `BC-001` through `BC-012` MUST run in CI on every PR touching:
  - `src/contracts/**`
  - `src/index/**`
  - `docs/specs/unified-syntax-representation.md`
  - `tests/lang/matrix/**`
- Any failing strict scenario (`BC-001`, `BC-002`, `BC-003`, `BC-005`, `BC-006`, `BC-008`, `BC-009`, `BC-010`, `BC-012`) is release-blocking.
- Non-strict scenario failures are warning-level until explicitly promoted by release policy, but MUST still produce diagnostics.
- Matrix results MUST be emitted to `usr-backcompat-matrix-results.json` and linked from release readiness scorecard evidence.

### 36.4 Required machine-readable matrix artifact

Implementations MUST maintain:

- `tests/lang/matrix/usr-backcompat-matrix.json`

Each scenario entry MUST include:

- `id`
- `producerVersion`
- `readerVersions`
- `readerMode`
- `fixtureFamily`
- `expectedOutcome`
- `requiredDiagnostics`
- `blocking`

### 36.5 Mandatory entity coverage per scenario class

At least one fixture in each scenario class MUST include all entity families below unless explicitly marked not-applicable.

| Scenario class | Required entities |
| --- | --- |
| strict accept (`BC-001`, `BC-002`, `BC-005`) | document, segment, node, symbol, edge, flow path, route, style scope, diagnostic |
| strict reject (`BC-003`, `BC-006`, `BC-008`, `BC-009`, `BC-010`, `BC-012`) | minimum failing entity + dependency chain proving rejection path |
| non-strict accept-with-adapter (`BC-004`, `BC-007`, `BC-011`) | document, segment, node, symbol, edge, diagnostic |

`not-applicable` cases are allowed only for framework-specific entities (`route`, `style scope`) in pure non-framework fixtures and MUST be explicitly tagged in matrix artifacts.

### 36.6 Release gate thresholds for matrix stability

- For strict scenarios, pass rate MUST be 100% for blocking lanes.
- For non-strict scenarios, pass rate MUST be >= 99% with any failures triaged and linked to explicit issue IDs.
- Compatibility matrix execution time MUST remain within documented lane budget; overruns require explicit waiver metadata in run reports.

### 36.7 Pairwise scenario expansion rules

`BC-001` through `BC-012` are baseline scenario classes. Test generators MUST expand them into concrete pairwise cases by:

1. producer implementation variant:
   - canonical writer
   - writer with extension fields enabled
2. reader implementation variant:
   - strict validator reader
   - non-strict adapter reader
3. fixture profile:
   - language-only fixture
   - framework fixture
   - degraded/partial capability fixture

Expanded scenario IDs MUST follow this format:

`<baseId>-<producerVariant>-<readerVariant>-<fixtureProfile>`

Example:

- `BC-007-ext-nonstrict-framework`

### 36.8 Mandatory reporting dimensions

Compatibility reports MUST include rollups by:

- `baseScenarioId`
- `producerVersion`
- `readerVersion`
- `readerMode`
- `languageId`
- `frameworkProfile` (nullable)
- `entityType`

Missing any reporting dimension is a contract failure for matrix reporting.

## 37. Decomposed contract governance (normative)

Decomposed USR contracts are required extensions of this umbrella spec, not optional commentary.

Required governance behavior:

- Tier 2 or Tier 3 USR changes MUST update impacted decomposed contracts in the same change set.
- Per-language profile changes MUST update both machine-readable registries and corresponding `docs/specs/usr/languages/<language-id>.md` file.
- CI MUST fail when decomposed contract drift checks detect missing required references or mismatched key sets.
- Release promotion MUST include evidence that umbrella and decomposed contract checks are both green.

## 38. Embedded-language bridge contract (normative)

Decomposed contract:

- `docs/specs/usr-embedding-bridge-contract.md`

USR MUST preserve deterministic bridge semantics whenever one document contains multiple language surfaces (for example `.vue`, `.svelte`, `.astro`, Razor, Angular template/style pairs, HTML with inline script/style).

Required behavior:

- producers MUST emit stable virtual segment identities for each embedded surface
- cross-segment edges MUST include bridge evidence attrs (`bridgeType`, `sourceSegmentUid`, `targetSegmentUid`)
- template to script symbol bindings MUST retain both template range and script range provenance
- style scope ownership MUST resolve to canonical owner symbols or emit deterministic unresolved diagnostics
- failure in one embedded surface MUST NOT suppress valid entities from sibling surfaces

Required machine-readable matrix:

- `tests/lang/matrix/usr-embedding-bridge-cases.json`

Each case entry MUST include:

- `id`
- `containerKind`
- `sourceLanguageId`
- `targetLanguageId`
- `requiredEdgeKinds`
- `requiredDiagnostics`
- `blocking`

## 39. Generated/macro provenance contract (normative)

Decomposed contract:

- `docs/specs/usr-generated-provenance-contract.md`

USR MUST preserve source provenance for generated, macro-expanded, transpiled, or compiler-synthesized artifacts.

Required behavior:

- normalized entities derived from generated/macro/transpiled surfaces MUST carry provenance attrs (`provenanceKind`, `originPath`, `originRange`, `generatorKind`)
- mappings from generated entities to original source coordinates MUST be deterministic and repeatable
- when exact origin mapping is unavailable, producers MUST emit deterministic fallback diagnostics and downgrade confidence
- downstream readers MUST be able to distinguish source-authored vs generated entities without heuristic inference

Required machine-readable matrix:

- `tests/lang/matrix/usr-generated-provenance-cases.json`

Each case entry MUST include:

- `id`
- `languageId`
- `generationKind`
- `mappingExpectation`
- `requiredDiagnostics`
- `blocking`



