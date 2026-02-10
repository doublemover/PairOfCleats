# Spec -- USR Framework Profile Catalog

Status: Draft v0.1
Last updated: 2026-02-10T04:00:00Z

## 0. Purpose and scope

This document defines framework profile contracts for USR overlays.

It is a decomposition of `docs/specs/unified-syntax-representation.md` sections 10 and 35.

Covered framework profiles:

- React
- Vue 3
- Next.js
- Nuxt 3
- Svelte
- SvelteKit
- Angular
- Astro

## 1. Canonical schema (normative)

```ts
type USRFrameworkProfileV1 = {
  id: "react" | "vue" | "next" | "nuxt" | "svelte" | "sveltekit" | "angular" | "astro";
  detectionPrecedence: string[]; // highest to lowest signals
  appliesToLanguages: string[];
  segmentationRules: {
    blocks: string[]; // script/template/style/frontmatter/etc
    ordering: string[]; // required extraction order
    crossBlockLinking: string[]; // required bridge types
  };
  bindingSemantics: {
    requiredEdgeKinds: Array<"template_binds" | "template_emits" | "style_scopes" | "route_maps_to" | "hydration_boundary">;
    requiredAttrs: Record<string, string[]>;
  };
  routeSemantics: {
    enabled: boolean;
    patternCanon: "bracket-form";
    runtimeSides: Array<"server" | "client" | "universal" | "unknown">;
  };
  hydrationSemantics: {
    required: boolean;
    boundarySignals: string[];
    ssrCsrModes: string[];
  };
  requiredConformance: Array<"C4">;
};
```

## 2. Detection precedence policy (normative)

All framework detection MUST be deterministic.

Generic precedence:

1. explicit config override
2. canonical file convention
3. package dependency + directory conventions
4. compiler/directive signatures
5. heuristic fallback

If heuristics are required, emit `USR-W-FRAMEWORK-PROFILE-INCOMPLETE` or explicit ambiguity diagnostics.

## 3. Common segmentation and extraction ordering

Framework containers MUST follow this ordering:

1. container block segmentation
2. virtual document creation and range mapping
3. parser/compiler per block
4. block-local nodes/symbols
5. cross-block binding edges
6. route/style/hydration enrichment

Failure after step 1 MUST preserve partial outputs and emit diagnostics.

## 4. Per-framework contracts (normative)

### 4.1 React

- Detection precedence:
  - `.jsx/.tsx` + React import usage
  - JSX runtime config
  - package signatures (`react`, `react-dom`)
- Segmentation:
  - script-only containers with JSX nodes
  - optional CSS modules and CSS-in-JS synthetic style scopes
- Binding semantics:
  - `template_binds` for prop and callback binding
  - `route_maps_to` via router config/JSX route nodes
  - `style_scopes` for module/token linkage
- Route semantics:
  - applicable with React Router-style configs
  - canonical route pattern MUST use bracket form
- SSR/CSR/hydration:
  - capture boundaries for server-rendered and client-hydrated components

### 4.2 Vue 3

- Detection precedence:
  - `.vue` container
  - SFC compiler metadata
  - Vue runtime/directory conventions
- Segmentation:
  - `template`, `script`, `script setup`, `style`, custom blocks
- Binding semantics:
  - `template_binds` for directives (`v-bind`, `v-model`, `v-on`, slot props)
  - `template_emits` for emit/event surfaces
  - `style_scopes` for scoped/module/global styles
- Route semantics:
  - `route_maps_to` via Vue Router configs and file-route conventions in Nuxt overlays
- SSR/CSR/hydration:
  - mark hydration boundaries for async/suspense/teleport where represented

### 4.3 Next.js

- Detection precedence:
  - `app/` or `pages/` router structure
  - route conventions (`page`, `layout`, `route`, middleware)
  - package + config signals
- Segmentation:
  - script-first with optional metadata from colocated styles/templates
- Binding semantics:
  - route to page/layout/handler via `route_maps_to`
  - server/client boundary bindings and data bindings via `template_binds`
- Route semantics:
  - file-system route canonicalization to bracket form
  - route handlers include method and runtime side attribution
- SSR/CSR/hydration:
  - required boundary extraction for server components and client islands

### 4.4 Nuxt 3

- Detection precedence:
  - `nuxt.config*` + `pages/` and `server/` conventions
  - package signatures
- Segmentation:
  - Vue SFC segmentation plus Nuxt server and route overlays
- Binding semantics:
  - composable/route/template bindings
  - style scope linkage for SFC styles
- Route semantics:
  - file-system route extraction with canonical bracket patterns
- SSR/CSR/hydration:
  - universal code paths must include runtime side metadata

### 4.5 Svelte

- Detection precedence:
  - `.svelte` containers
  - compiler signatures
- Segmentation:
  - module script, instance script, template, style
- Binding semantics:
  - `bind:`, event, slot bindings via `template_binds`
  - style ownership via `style_scopes`
- Route semantics:
  - optional unless explicit router present
- SSR/CSR/hydration:
  - hydration boundaries where runtime/compile metadata allows

### 4.6 SvelteKit

- Detection precedence:
  - route conventions (`+page`, `+layout`, `+server`)
  - project config and package signatures
- Segmentation:
  - Svelte segmentation + route/endpoint overlays
- Binding semantics:
  - `route_maps_to` for route files to symbols/docs
  - `template_binds` from `load`/form/action data propagation
- Route semantics:
  - file-system routes canonicalized to bracket patterns
- SSR/CSR/hydration:
  - required server/client boundary extraction

### 4.7 Angular

- Detection precedence:
  - decorators and Angular metadata
  - route config signatures
  - workspace config and package signals
- Segmentation:
  - TypeScript component/controller + external/inline template and style surfaces
- Binding semantics:
  - template bindings for input/output/directive semantics
  - style scoping with encapsulation metadata
- Route semantics:
  - route config normalization to canonical patterns
- SSR/CSR/hydration:
  - boundaries for universal rendering and client hydration when present

### 4.8 Astro

- Detection precedence:
  - `.astro` containers
  - Astro config and content route patterns
- Segmentation:
  - frontmatter, template, style, island component boundaries
- Binding semantics:
  - frontmatter-template bindings
  - style scopes with scoped/global escapes
- Route semantics:
  - file-system and content route canonicalization
- SSR/CSR/hydration:
  - island hydration directives MUST map to `hydration_boundary` edges

## 5. Canonical attrs requirements by edge family

| Edge kind | Required attrs | Notes |
| --- | --- | --- |
| `route_maps_to` | `routePattern`, `router` | route pattern MUST use bracket canonical form |
| `template_binds` | `bindingKind`, `bindingName` | directive/event syntax MAY be additional attrs |
| `style_scopes` | `scopeType`, `styleSystem` | scope tokens/encapsulation MAY be additional attrs |
| `hydration_boundary` | `boundaryType`, `runtimeSide` | required when framework exposes SSR/CSR boundaries |

## 6. C4 conformance requirements

A framework profile passes `C4` only if:

- required segmentation surfaces are emitted
- required route/template/style edges are emitted with canonical attrs
- profile-specific edge-case families pass
- diagnostics for degraded/incomplete cases are explicit and deterministic

## 7. Framework detection conflict resolution policy

When multiple framework candidates are detected for one document or segment:

1. apply explicit config override if present
2. apply strongest file-convention match
3. apply compiler/runtime signature match
4. if still tied, choose lexical framework ID winner and emit conflict diagnostics

Conflict outcomes MUST emit:

- `USR-E-PROFILE-CONFLICT` when constraints conflict
- `USR-W-FRAMEWORK-PROFILE-INCOMPLETE` when fallback tie-break selection is used

## 8. Required artifacts and files

- `tests/lang/matrix/usr-framework-profiles.json`
- `tests/lang/matrix/usr-framework-edge-cases.json` (recommended)
- fixture families under `tests/fixtures/usr/frameworks/<framework-id>/`

Additional validation rules:

- profile IDs are unique and sorted
- `appliesToLanguages` entries are valid registry language IDs
- required attrs maps for edge families include at least required keys from this spec
- segmentation ordering arrays match canonical extraction phases

Recommended report outputs:

- `usr-framework-profile-coverage.json`
- `usr-framework-detection-conflicts.json`
- `usr-framework-canonicalization-gaps.json`

## 9. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`

