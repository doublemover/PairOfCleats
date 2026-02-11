# Spec -- USR Registry Schema and Serialization Contract

Status: Draft v0.7
Last updated: 2026-02-11T03:30:00Z

## 0. Purpose and scope

This document defines canonical machine-readable schema shapes, key constraints, and serialization rules for all USR registry and matrix files under `tests/lang/matrix/`.

It decomposes `docs/specs/unified-syntax-representation.md` sections 23 and 24.

## 1. Required registry files (normative)

Implementations MUST maintain and validate all files below:

- `usr-language-profiles.json`
- `usr-language-version-policy.json`
- `usr-language-embedding-policy.json`
- `usr-framework-profiles.json`
- `usr-node-kind-mapping.json`
- `usr-edge-kind-constraints.json`
- `usr-capability-matrix.json`
- `usr-conformance-levels.json`
- `usr-backcompat-matrix.json`
- `usr-framework-edge-cases.json`
- `usr-language-risk-profiles.json`
- `usr-embedding-bridge-cases.json`
- `usr-generated-provenance-cases.json`
- `usr-parser-runtime-lock.json`
- `usr-slo-budgets.json`
- `usr-alert-policies.json`
- `usr-redaction-rules.json`
- `usr-security-gates.json`
- `usr-runtime-config-policy.json`
- `usr-failure-injection-matrix.json`
- `usr-fixture-governance.json`
- `usr-benchmark-policy.json`
- `usr-threat-model-matrix.json`
- `usr-waiver-policy.json`
- `usr-quality-gates.json`
- `usr-operational-readiness-policy.json`

## 2. Canonical wrappers and metadata

Every registry file MUST follow:

```ts
type USRRegistryFileV1<T> = {
  schemaVersion: "usr-registry-1.0.0";
  registryId: string;
  generatedAt: string; // ISO 8601
  generatedBy: string;
  rows: T[];
};
```

Rules:

- `registryId` MUST match filename stem exactly.
- `generatedBy` SHOULD reference a committed generator or writer entrypoint (current baseline: `tools/usr/generate-usr-matrix-baselines.mjs`).
- `rows` MUST be deterministically sorted according to section 4.
- unknown top-level keys are strict-mode errors.

## 3. Per-registry row minimum schema

### 3.1 `usr-language-profiles.json`

```ts
type USRLanguageProfileRowV1 = {
  id: string;
  parserPreference: "native" | "tree-sitter" | "hybrid" | "heuristic";
  languageVersionPolicy: {
    minVersion: string;
    maxVersion: string | null;
    dialects: string[];
    featureFlags: string[];
  };
  embeddingPolicy: {
    canHostEmbedded: boolean;
    canBeEmbedded: boolean;
    embeddedLanguageAllowlist: string[];
  };
  requiredNodeKinds: string[];
  requiredEdgeKinds: string[];
  requiredCapabilities: Record<string, "supported" | "partial" | "unsupported">;
  fallbackChain: Array<"native-parser" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic">;
  frameworkProfiles: string[];
  requiredConformance: Array<"C0" | "C1" | "C2" | "C3" | "C4">;
  notes?: string;
};
```

### 3.2 `usr-language-version-policy.json`

```ts
type USRLanguageVersionPolicyRowV1 = {
  languageId: string;
  minVersion: string;
  maxVersion: string | null;
  dialects: string[];
  featureFlags: string[];
};
```

### 3.3 `usr-language-embedding-policy.json`

```ts
type USRLanguageEmbeddingPolicyRowV1 = {
  languageId: string;
  canHostEmbedded: boolean;
  canBeEmbedded: boolean;
  embeddedLanguageAllowlist: string[];
};
```

### 3.4 `usr-framework-profiles.json`

```ts
type USRFrameworkProfileRowV1 = {
  id: "react" | "vue" | "next" | "nuxt" | "svelte" | "sveltekit" | "angular" | "astro";
  detectionPrecedence: string[];
  appliesToLanguages: string[];
  segmentationRules: {
    blocks: string[];
    ordering: string[];
    crossBlockLinking: string[];
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
  embeddedLanguageBridges: Array<{
    sourceBlock: string;
    targetBlock: string;
    edgeKinds: string[];
  }>;
  edgeCaseCaseIds: string[];
  requiredConformance: Array<"C4">;
};
```

### 3.5 `usr-node-kind-mapping.json`

```ts
type USRNodeKindMappingRuleRowV1 = {
  languageId: string; // registry language ID or "*"
  parserSource: "native-parser" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic" | "*";
  rawKind: string;
  normalizedKind: string;
  category: string;
  confidence: number; // 0..1
  priority: number; // >= 0
  provenance: "parser" | "compiler" | "adapter" | "manual-policy";
  languageVersionSelector?: string | null;
  notes?: string;
};
```

### 3.6 `usr-edge-kind-constraints.json`

```ts
type USREdgeKindConstraintRowV1 = {
  edgeKind: string;
  sourceEntityKinds: Array<"document" | "segment" | "node" | "symbol">;
  targetEntityKinds: Array<"document" | "segment" | "node" | "symbol">;
  requiredAttrs: string[];
  optionalAttrs: string[];
  blocking: boolean;
};
```

### 3.7 `usr-capability-matrix.json`

```ts
type USRCapabilityMatrixRowV1 = {
  languageId: string;
  frameworkProfile: string | null;
  capability: string;
  state: "supported" | "partial" | "unsupported";
  requiredConformance: Array<"C0" | "C1" | "C2" | "C3" | "C4">;
  downgradeDiagnostics: string[];
  blocking: boolean;
};
```

### 3.8 `usr-conformance-levels.json`

```ts
type USRConformanceLevelRowV1 = {
  profileType: "language" | "framework";
  profileId: string;
  requiredLevels: Array<"C0" | "C1" | "C2" | "C3" | "C4">;
  blockingLevels: Array<"C0" | "C1" | "C2" | "C3" | "C4">;
  requiredFixtureFamilies: string[];
};
```

### 3.9 `usr-backcompat-matrix.json`

```ts
type USRBackcompatScenarioRowV1 = {
  id: string; // BC-001..BC-012
  producerVersion: string;
  readerVersions: string[];
  readerMode: "strict" | "non-strict";
  fixtureFamily: string;
  expectedOutcome: "accept" | "reject" | "accept-with-adapter";
  requiredDiagnostics: string[];
  blocking: boolean;
};
```

### 3.10 `usr-framework-edge-cases.json`

```ts
type USRFrameworkEdgeCaseRowV1 = {
  id: string;
  frameworkProfile: "react" | "vue" | "next" | "nuxt" | "svelte" | "sveltekit" | "angular" | "astro";
  category: "route" | "template" | "style" | "hydration" | "bridge";
  requiredEdgeKinds: string[];
  requiredDiagnostics: string[];
  blocking: boolean;
};
```

### 3.11 `usr-language-risk-profiles.json`

```ts
type USRLanguageRiskProfileRowV1 = {
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

### 3.12 `usr-embedding-bridge-cases.json`

```ts
type USREmbeddingBridgeCaseRowV1 = {
  id: string;
  containerKind: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  requiredEdgeKinds: string[];
  requiredDiagnostics: string[];
  blocking: boolean;
};
```

### 3.13 `usr-generated-provenance-cases.json`

```ts
type USRGeneratedProvenanceCaseRowV1 = {
  id: string;
  languageId: string;
  generationKind: string;
  mappingExpectation: "exact" | "approximate" | "missing";
  requiredDiagnostics: string[];
  blocking: boolean;
};
```

### 3.14 `usr-parser-runtime-lock.json`

```ts
type USRParserRuntimeLockRowV1 = {
  parserSource: "native-parser" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic";
  languageId: string | "*";
  parserName: string;
  parserVersion: string;
  runtimeName: string | null;
  runtimeVersion: string | null;
  lockReason: string;
};
```

### 3.15 `usr-slo-budgets.json`

```ts
type USRSLOBudgetRowV1 = {
  laneId: string;
  profileScope: "global" | "batch" | "language" | "framework";
  scopeId: string;
  maxDurationMs: number;
  maxMemoryMb: number;
  maxParserTimePerSegmentMs: number;
  maxUnknownKindRate: number;
  maxUnresolvedRate: number;
  blocking: boolean;
};
```

### 3.16 `usr-alert-policies.json`

```ts
type USRAlertPolicyRowV1 = {
  id: string;
  metric: string;
  threshold: number;
  comparator: ">" | ">=" | "<" | "<=";
  window: "run" | "24h" | "7d";
  severity: "warning" | "critical";
  escalationPolicyId: string;
  blocking: boolean;
};
```

### 3.17 `usr-redaction-rules.json`

```ts
type USRRedactionRuleRowV1 = {
  id: string;
  class: string;
  replacement: string;
  appliesTo: string[];
  blocking: boolean;
};
```

### 3.18 `usr-security-gates.json`

```ts
type USRSecurityGateRowV1 = {
  id: string;
  check: string;
  scope: "parser" | "path" | "serialization" | "reporting" | "runtime";
  enforcement: "strict" | "warn";
  blocking: boolean;
};
```

### 3.19 `usr-runtime-config-policy.json`

```ts
type USRRuntimeConfigPolicyRowV1 = {
  id: string;
  key: string;
  valueType: "boolean" | "integer" | "number" | "string" | "enum" | "array" | "object";
  defaultValue: string | number | boolean | null;
  allowedValues?: Array<string | number | boolean>;
  minValue?: number | null;
  maxValue?: number | null;
  rolloutClass: "stable" | "experimental" | "migration-only";
  strictModeBehavior: "reject-unknown" | "warn-unknown" | "coerce" | "disallow";
  requiresRestart: boolean;
  blocking: boolean;
};
```

### 3.20 `usr-failure-injection-matrix.json`

```ts
type USRFailureInjectionRowV1 = {
  id: string;
  faultClass:
    | "parser-unavailable"
    | "parser-timeout"
    | "mapping-conflict"
    | "resolution-ambiguity-overflow"
    | "serialization-corruption"
    | "security-gate-failure"
    | "redaction-failure"
    | "resource-budget-breach";
  injectionLayer: "input" | "parser" | "normalization" | "resolution" | "serialization" | "reporting" | "runtime";
  strictExpectedOutcome: "fail-closed" | "degrade-with-diagnostics";
  nonStrictExpectedOutcome: "degrade-with-diagnostics" | "warn-only";
  requiredDiagnostics: string[];
  requiredReasonCodes: string[];
  blocking: boolean;
};
```

### 3.21 `usr-fixture-governance.json`

```ts
type USRFixtureGovernanceRowV1 = {
  fixtureId: string;
  profileType: "language" | "framework" | "cross-cutting";
  profileId: string;
  conformanceLevels: Array<"C0" | "C1" | "C2" | "C3" | "C4">;
  families: string[];
  owner: string;
  reviewers: string[];
  stabilityClass: "stable" | "volatile" | "experimental";
  mutationPolicy: "require-rfc" | "require-review" | "allow-generated-refresh";
  goldenRequired: boolean;
  blocking: boolean;
};
```

### 3.22 `usr-benchmark-policy.json`

```ts
type USRBenchmarkPolicyRowV1 = {
  id: string;
  laneId: string;
  datasetClass: "smoke" | "language-batch" | "framework-overlay" | "mixed-repo";
  hostClass: string;
  warmupRuns: number;
  measureRuns: number;
  percentileTargets: {
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
  };
  maxVariancePct: number;
  maxPeakMemoryMb: number;
  blocking: boolean;
};
```

### 3.23 `usr-threat-model-matrix.json`

```ts
type USRThreatModelRowV1 = {
  id: string;
  threatClass:
    | "path-traversal"
    | "untrusted-execution"
    | "sensitive-data-leakage"
    | "schema-confusion"
    | "parser-supply-chain"
    | "resource-exhaustion"
    | "reporting-exfiltration";
  attackSurface: "input" | "parser" | "normalization" | "resolution" | "serialization" | "reporting" | "runtime";
  requiredControls: string[];
  requiredFixtures: string[];
  severity: "low" | "medium" | "high" | "critical";
  blocking: boolean;
};
```

### 3.24 `usr-waiver-policy.json`

```ts
type USRWaiverPolicyRowV1 = {
  id: string;
  waiverClass:
    | "benchmark-overrun"
    | "non-strict-compat-warning"
    | "temporary-parser-regression"
    | "non-blocking-security-warning"
    | "observability-gap";
  scopeType: "lane" | "phase" | "language" | "framework" | "artifact";
  scopeId: string;
  allowedUntil: string; // ISO 8601
  approvers: string[];
  requiredCompensatingControls: string[];
  maxExtensions: number;
  blocking: boolean;
};
```

### 3.25 `usr-quality-gates.json`

```ts
type USRQualityGateRowV1 = {
  id: string;
  domain: "resolution" | "risk" | "framework-binding" | "provenance";
  scopeType: "global" | "language" | "framework";
  scopeId: string;
  metric: "precision" | "recall" | "f1" | "false-positive-rate" | "false-negative-rate";
  thresholdOperator: ">=" | "<=";
  thresholdValue: number; // 0..1
  fixtureSetId: string;
  blocking: boolean;
};
```

### 3.26 `usr-operational-readiness-policy.json`

```ts
type USROperationalReadinessRowV1 = {
  id: string;
  phase: "pre-cutover" | "cutover" | "post-cutover" | "incident";
  runbookId: string;
  severityClass: "sev1" | "sev2" | "sev3" | "n/a";
  requiredRoles: string[];
  requiredArtifacts: string[];
  communicationChannels: string[];
  maxResponseMinutes: number;
  maxRecoveryMinutes: number;
  blocking: boolean;
};
```

## 4. Canonical ordering policy

Sorting MUST be stable and deterministic.

Default row ordering:

1. primary ID key lexical (`languageId`, `id`, `edgeKind`, or `profileId`)
2. secondary discriminator lexical (`frameworkProfile`, `parserSource`, `generationKind`) when present
3. numeric priority ascending when present

Array field ordering:

- lexical ordering for identifiers and enums unless contract-specific ordering is required
- canonical conformance order for levels (`C0,C1,C2,C3,C4`)

## 5. Cross-registry invariants

The following MUST hold:

- all registry language IDs appear exactly once in:
  - `usr-language-profiles.json`
  - `usr-language-version-policy.json`
  - `usr-language-embedding-policy.json`
  - `usr-conformance-levels.json` rows with `profileType=language`
- framework IDs referenced by language and framework registries MUST exist in `usr-framework-profiles.json`.
- `edgeCaseCaseIds` declared in framework profiles MUST exactly resolve to rows in `usr-framework-edge-cases.json`.
- parser/runtime lock rows MUST cover all parser sources used by language and framework profiles.
- all capability rows MUST reference existing `languageId` and optional `frameworkProfile` keys.
- all conformance level rows MUST be consistent with language/framework profile required conformance declarations.
- case IDs referenced by bridge/provenance/risk contracts MUST resolve to existing matrix rows.
- SLO and alert policy matrices MUST cover all required lanes and blocking gate scopes.
- security gate and redaction matrices MUST cover required security control classes.
- runtime config policy keys MUST be unique and non-overlapping by canonical key path.
- failure injection matrix MUST cover all required blocking fault classes.
- fixture governance matrix profile IDs MUST resolve to language/framework profile registries.
- benchmark policy rows MUST define positive warmup and measure run counts, and deterministic percentile targets.
- threat-model rows MUST map every blocking security gate and critical threat class to at least one required fixture/control.
- waiver policy rows MUST be time-bounded and MUST NOT include disallowed strict-security bypass classes.
- quality-gate rows MUST use valid metric enums, operator/metric-compatible threshold operators, and `thresholdValue` within `[0,1]`.
- operational-readiness policy rows MUST declare non-empty required roles, artifacts, and incident communication channels for blocking entries.

## 6. Strict validation behavior

Strict validators MUST enforce:

- `schemaVersion` exact match
- required keys present
- unknown keys rejected
- enum values and numeric bounds validated
- deterministic ordering checks on output
- referential-integrity and exact-set invariants from section 5

Required validation outputs:

- `usr-registry-schema-validation.json`
- `usr-registry-cross-invariant-validation.json`
- `usr-registry-serialization-drift.json`

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-observability-and-slo-contract.md`
- `docs/specs/usr-security-and-data-governance-contract.md`
- `docs/specs/usr-runtime-config-contract.md`
- `docs/specs/usr-failure-injection-and-resilience-contract.md`
- `docs/specs/usr-fixture-governance-contract.md`
- `docs/specs/usr-performance-benchmark-contract.md`
- `docs/specs/usr-threat-model-and-abuse-case-contract.md`
- `docs/specs/usr-waiver-and-exception-contract.md`
- `docs/specs/usr-quality-evaluation-contract.md`
- `docs/specs/usr-operational-runbook-contract.md`
