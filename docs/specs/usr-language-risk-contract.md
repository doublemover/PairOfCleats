# Spec -- USR Language Risk Contract

Status: Draft v0.5
Last updated: 2026-02-10T08:15:00Z

## 0. Purpose and scope

This document defines risk taxonomy and behavior expectations by language and framework profile.

It decomposes `docs/specs/unified-syntax-representation.md` risk capability semantics and C3 conformance requirements.

## 1. Canonical schema (normative)

```ts
type USRLanguageRiskProfileV1 = {
  languageId: string;
  frameworkProfile?: string | null;
  required: {
    sources: string[];
    sinks: string[];
    sanitizers: string[];
  };
  optional: {
    sources: string[];
    sinks: string[];
    sanitizers: string[];
  };
  unsupported: {
    sources: string[];
    sinks: string[];
    sanitizers: string[];
  };
  capabilities: {
    riskLocal: "supported" | "partial" | "unsupported";
    riskInterprocedural: "supported" | "partial" | "unsupported";
  };
  interproceduralGating: {
    enabledByDefault: boolean;
    minEvidenceKinds: string[];
    requiredCallLinkConfidence: number;
  };
  severityPolicy: {
    levels: Array<"info" | "low" | "medium" | "high" | "critical">;
    defaultLevel: "info" | "low" | "medium" | "high" | "critical";
  };
};
```

## 2. Risk taxonomy classes

Taxonomy entries MUST be grouped by class:

- code execution
- command/process execution
- filesystem mutation
- network outbound
- deserialization/reflection
- template injection
- SQL/query injection
- XSS/HTML injection
- auth/session misuse

## 3. Required baseline by language family

| Language family | Required local risk behavior | Interprocedural default |
| --- | --- | --- |
| JS/TS | `supported` with runtime sink/source coverage | `partial` or `supported` based on call-link confidence |
| Python/Ruby/PHP | `supported` for dynamic execution/process/file/network sinks | `partial` minimum |
| Systems (`clike,go,rust,swift`) | `supported` for unsafe memory/process/network classes | `partial` minimum |
| Managed OO | `supported` for reflection/deserialization/process/query classes | `partial` minimum |
| Markup/template/style | `partial` local risk via template/style sink classes | `unsupported` unless bridged to script language |
| Build/data DSL | `partial` risk coverage where execution semantics exist | `unsupported` or `partial` with explicit policy |

## 4. Framework overlay risk requirements

Framework overlays MUST add required risk classes:

- React/Next: unsafe HTML injection and server/client boundary sink handling
- Vue/Nuxt: template HTML injection and route/middleware taint surfaces
- Svelte/SvelteKit: template binding injection and route data flow sinks
- Angular: template binding sanitization and bypass APIs
- Astro: frontmatter-template bridge and island boundary injection surfaces

## 5. Required vs optional vs unsupported policy

Rules:

- `required` entries MUST have at least one passing fixture/assertion each
- `optional` entries MAY be partial but MUST emit explicit diagnostics when absent
- `unsupported` entries MUST not be silently emitted as resolved risk semantics

## 6. Interprocedural gating rules

Interprocedural risk propagation MUST be gated by:

- call-link quality thresholds
- bounded propagation limits
- deterministic rerun behavior
- explicit fallback diagnostics when downgraded

Minimum gating policy:

- if call-link confidence is below threshold, downgrade `riskInterprocedural` to `partial`
- if no call-link artifacts exist, set `riskInterprocedural=unsupported` unless profile explicitly allows heuristic propagation

## 7. Risk taxonomy row requirements

Each taxonomy row in machine-readable risk profiles MUST include:

- `id` (stable risk signal ID)
- `class` (taxonomy class from section 2)
- `kind` (`source|sink|sanitizer`)
- `languageId`
- `frameworkProfile` (nullable)
- `evidenceKinds` (minimum evidence required)
- `defaultSeverity`
- `remediationClass`

Signal IDs MUST be stable across minor versions.

## 8. Provenance-aware risk attribution

Risk findings derived from generated/macro/transpiled surfaces MUST preserve provenance attrs:

- risk findings MUST include origin mapping quality from the provenance contract
- findings with approximate or missing provenance MUST include downgrade diagnostics
- cross-segment/template bridge risk findings MUST preserve bridge evidence attrs

## 9. Required artifacts and files

- `tests/lang/matrix/usr-language-risk-profiles.json`
- risk fixtures under `tests/fixtures/usr/risk/<language-id>/`

Required report outputs:

- `usr-risk-coverage-summary.json`
- `usr-risk-signal-distribution.json`
- `usr-risk-gating-downgrades.json`

## 10. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-embedding-bridge-contract.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/specs/usr-registry-schema-contract.md`


