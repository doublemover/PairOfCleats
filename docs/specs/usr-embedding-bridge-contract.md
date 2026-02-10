# Spec -- USR Embedding and Bridge Contract

Status: Draft v0.2
Last updated: 2026-02-10T08:15:00Z

## 0. Purpose and scope

This document defines deterministic USR behavior for multi-surface documents that contain embedded or bridged language regions.

It decomposes `docs/specs/unified-syntax-representation.md` section 38.

Covered containers include:

- Vue SFC (`.vue`)
- Svelte/SvelteKit (`.svelte`)
- Astro (`.astro`)
- Angular component template/style combinations
- Razor mixed template/code surfaces
- HTML with inline script/style regions

## 1. Canonical bridge schema (normative)

Bridge evidence fields on cross-segment edges MUST follow:

```ts
type USRBridgeEvidenceV1 = {
  bridgeType:
    | "template_to_script"
    | "script_to_template"
    | "template_to_style"
    | "style_to_template"
    | "route_to_component"
    | "component_to_route"
    | "frontmatter_to_template"
    | "inline_region";
  sourceSegmentUid: string;
  targetSegmentUid: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  bridgeConfidence: number; // 0..1 canonical normalized
  bridgeSignals: string[]; // deterministic ordered evidence labels
};
```

Rules:

- `sourceSegmentUid` and `targetSegmentUid` MUST be valid segment IDs and MUST reference segments in the same logical document unless explicit cross-document bridge is declared.
- `sourceLanguageId` and `targetLanguageId` MUST be registry language IDs.
- `bridgeSignals` MUST be deterministic and lexically sorted.
- `bridgeConfidence` MUST follow USR numeric normalization rules.

## 2. Virtual segment invariants

Producers MUST:

1. create virtual segments for each embedded language region with stable IDs
2. preserve parent container relationship via `contains` edges
3. preserve source ranges for container region and embedded region
4. preserve sibling segment emission even when one segment parse fails

Failure in one segment MUST emit diagnostics and MUST NOT delete already valid entities from sibling segments.

## 3. Required bridge edge families

The following edge families are mandatory where applicable:

- `template_binds`
- `template_emits`
- `style_scopes`
- `route_maps_to`
- `hydration_boundary`

Every emitted bridge edge MUST include bridge evidence attrs from section 1.

## 4. Container-specific canonicalization policy

Required canonical policies by container family:

- Vue/Nuxt: `template <-> script setup/script <-> style` bridge surfaces MUST be emitted.
- Svelte/SvelteKit: module script, instance script, template, and style bridges MUST be emitted.
- Astro: frontmatter to template and island-component bridge surfaces MUST be emitted.
- Angular: component TypeScript to template and template to style ownership bridges MUST be emitted.
- Razor/HTML mixed surfaces: inline code or script/style region bridges MUST be emitted when deterministic.

## 5. Ambiguity and degradation policy

When bridge targets are ambiguous or unavailable:

- emit unresolved/ambiguous status with canonical reason codes
- include deterministic candidate ordering in resolution envelopes
- preserve source bridge edges with downgraded confidence where valid
- emit degradation diagnostics without suppressing unaffected bridge edges

## 6. Required machine-readable artifacts

Implementations MUST maintain:

- `tests/lang/matrix/usr-embedding-bridge-cases.json`

Every case row MUST include:

- `id`
- `containerKind`
- `sourceLanguageId`
- `targetLanguageId`
- `requiredEdgeKinds`
- `requiredDiagnostics`
- `blocking`

Required report outputs:

- `usr-embedding-bridge-coverage.json`
- `usr-embedding-bridge-gaps.json`
- `usr-embedding-bridge-drift.json`

## 7. Conformance requirements

Required conformance checks:

- deterministic virtual segment ID emission across reruns
- bridge edge endpoint integrity and attrs validation
- unresolved/ambiguous bridge diagnostics correctness
- bridge confidence normalization and ordering stability

Bridge conformance failures are blocking for framework profiles requiring C4.

## 8. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
