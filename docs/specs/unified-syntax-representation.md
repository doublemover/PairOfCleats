# Spec -- Unified Syntax Representation (USR)

Status: Draft v0.2
Last updated: 2026-02-10T00:00:00Z

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
- `docs/contracts/public-artifact-surface.md`
- `docs/contracts/artifact-schemas.md`
- `docs/contracts/analysis-schemas.md`
- `src/index/language-registry/registry-data.js`

## 23. Required machine-readable registries

USR requires machine-readable registries to prevent doc drift.

Required files:

- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-framework-profiles.json`
- `tests/lang/matrix/usr-node-kind-mapping.json`
- `tests/lang/matrix/usr-edge-kind-constraints.json`
- `tests/lang/matrix/usr-capability-matrix.json`
- `tests/lang/matrix/usr-conformance-levels.json`

Registry drift policy:

- registry language IDs and `usr-language-profiles.json` entries MUST be exact-set equal
- framework profile IDs referenced by language profiles MUST exist in `usr-framework-profiles.json`
- unknown keys in registry JSON MUST fail strict schema validation

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
