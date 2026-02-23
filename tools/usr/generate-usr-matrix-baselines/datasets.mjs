import { buildFixtureGovernance } from './fixture-governance.mjs';
import {
  CAPABILITIES,
  languageBaselines,
  familyNodeKinds,
  familyEdgeKinds,
  familyCapabilities,
  parserFallbackByPreference,
  customEmbeddingPolicies
} from './datasets-language-families.mjs';
import {
  frameworkProfiles,
  frameworkEdgeCases,
  edgeKindConstraints,
  nodeKindMappings
} from './datasets-framework-families.mjs';

const SCHEMA_VERSION = 'usr-registry-1.0.0';

const backcompatMatrix = [
  { id: 'BC-001', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'language-core', expectedOutcome: 'accept', requiredDiagnostics: [], blocking: true },
  { id: 'BC-002', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.1.0'], readerMode: 'strict', fixtureFamily: 'framework-overlay', expectedOutcome: 'accept', requiredDiagnostics: [], blocking: true },
  { id: 'BC-003', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'language-core', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-004', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'non-strict', fixtureFamily: 'language-core', expectedOutcome: 'accept-with-adapter', requiredDiagnostics: ['USR-W-BACKCOMPAT-ADAPTER'], blocking: false },
  { id: 'BC-005', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0', 'usr-1.1.0'], readerMode: 'strict', fixtureFamily: 'degraded-capability', expectedOutcome: 'accept', requiredDiagnostics: ['USR-W-CAPABILITY-DOWNGRADED'], blocking: true },
  { id: 'BC-006', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'enum-change', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-007', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'non-strict', fixtureFamily: 'enum-change', expectedOutcome: 'accept-with-adapter', requiredDiagnostics: ['USR-W-BACKCOMPAT-ADAPTER'], blocking: false },
  { id: 'BC-008', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'required-field-removal', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-009', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'coordinate-corruption', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-010', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'reason-code-expansion', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], blocking: true },
  { id: 'BC-011', producerVersion: 'usr-1.1.0', readerVersions: ['usr-1.0.0'], readerMode: 'non-strict', fixtureFamily: 'reason-code-expansion', expectedOutcome: 'accept-with-adapter', requiredDiagnostics: ['USR-W-BACKCOMPAT-ADAPTER'], blocking: false },
  { id: 'BC-012', producerVersion: 'usr-1.0.0', readerVersions: ['usr-1.0.0'], readerMode: 'strict', fixtureFamily: 'edge-endpoint-violation', expectedOutcome: 'reject', requiredDiagnostics: ['USR-E-EDGE-ENDPOINT-CONSTRAINT'], blocking: true }
];

const embeddingBridgeCases = [
  { id: 'bridge-angular-component-template', containerKind: 'angular-component', sourceLanguageId: 'typescript', targetLanguageId: 'html', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-astro-frontmatter-template', containerKind: 'astro', sourceLanguageId: 'typescript', targetLanguageId: 'html', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-astro-template-style', containerKind: 'astro', sourceLanguageId: 'html', targetLanguageId: 'css', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-html-inline-script', containerKind: 'html-inline', sourceLanguageId: 'html', targetLanguageId: 'javascript', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: ['USR-W-BRIDGE-PARTIAL'], blocking: false },
  { id: 'bridge-razor-template-csharp', containerKind: 'razor', sourceLanguageId: 'razor', targetLanguageId: 'csharp', requiredEdgeKinds: ['template_binds'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-svelte-template-style', containerKind: 'svelte', sourceLanguageId: 'html', targetLanguageId: 'css', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-svelte-template-typescript', containerKind: 'svelte', sourceLanguageId: 'html', targetLanguageId: 'typescript', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-vue-template-script', containerKind: 'vue-sfc', sourceLanguageId: 'html', targetLanguageId: 'typescript', requiredEdgeKinds: ['template_binds', 'template_emits'], requiredDiagnostics: [], blocking: true },
  { id: 'bridge-vue-template-style', containerKind: 'vue-sfc', sourceLanguageId: 'html', targetLanguageId: 'css', requiredEdgeKinds: ['style_scopes'], requiredDiagnostics: [], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const generatedProvenanceCases = [
  { id: 'prov-angular-template-compiler', languageId: 'typescript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-astro-island-generated', languageId: 'javascript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-clike-preprocessor', languageId: 'clike', generationKind: 'macro', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-go-codegen', languageId: 'go', generationKind: 'codegen', mappingExpectation: 'exact', requiredDiagnostics: [], blocking: true },
  { id: 'prov-javascript-babel-output', languageId: 'javascript', generationKind: 'transpile', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-proto-stub-generated', languageId: 'proto', generationKind: 'codegen', mappingExpectation: 'exact', requiredDiagnostics: [], blocking: true },
  { id: 'prov-rust-macro-expand', languageId: 'rust', generationKind: 'macro', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-svelte-compiler-output', languageId: 'typescript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false },
  { id: 'prov-typescript-transpile-js', languageId: 'typescript', generationKind: 'transpile', mappingExpectation: 'exact', requiredDiagnostics: [], blocking: true },
  { id: 'prov-vue-sfc-compiler', languageId: 'typescript', generationKind: 'framework-compiler', mappingExpectation: 'approximate', requiredDiagnostics: ['USR-W-PROVENANCE-APPROXIMATE'], blocking: false }
].sort((a, b) => a.id.localeCompare(b.id));

const parserRuntimeLocks = [
  { parserSource: 'framework-compiler', languageId: '*', parserName: 'framework-compiler-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'framework-compiler-baseline', maxUpgradeBudgetDays: 45 },
  { parserSource: 'heuristic', languageId: '*', parserName: 'heuristic-fallback-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'fallback-safety-net', maxUpgradeBudgetDays: 90 },
  { parserSource: 'hybrid', languageId: '*', parserName: 'hybrid-parser-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'hybrid-chain-lock', maxUpgradeBudgetDays: 75 },
  { parserSource: 'native-parser', languageId: '*', parserName: 'native-parser-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'primary-parser-lock', maxUpgradeBudgetDays: 30 },
  { parserSource: 'tooling', languageId: '*', parserName: 'tooling-adapter-baseline', parserVersion: '1.0.0', runtimeName: 'node', runtimeVersion: '20.x', lockReason: 'tooling-adapter-lock', maxUpgradeBudgetDays: 60 },
  { parserSource: 'tree-sitter', languageId: '*', parserName: 'tree-sitter-core', parserVersion: '0.22.0', runtimeName: 'node-tree-sitter', runtimeVersion: '0.21.x', lockReason: 'tree-sitter-lock', maxUpgradeBudgetDays: 30 }
].sort((a, b) => {
  if (a.parserSource !== b.parserSource) return a.parserSource.localeCompare(b.parserSource);
  return a.languageId.localeCompare(b.languageId);
});

const sloBudgets = [
  { laneId: 'ci', profileScope: 'global', scopeId: 'global', maxDurationMs: 1200000, maxMemoryMb: 4096, maxParserTimePerSegmentMs: 1500, maxUnknownKindRate: 0.02, maxUnresolvedRate: 0.02, blocking: true },
  { laneId: 'ci-long', profileScope: 'global', scopeId: 'global', maxDurationMs: 2000000, maxMemoryMb: 8192, maxParserTimePerSegmentMs: 2000, maxUnknownKindRate: 0.02, maxUnresolvedRate: 0.02, blocking: true },
  { laneId: 'lang-batch-javascript-typescript', profileScope: 'batch', scopeId: 'B1', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-systems-languages', profileScope: 'batch', scopeId: 'B2', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-managed-languages', profileScope: 'batch', scopeId: 'B3', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-dynamic-languages', profileScope: 'batch', scopeId: 'B4', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-markup-style-template', profileScope: 'batch', scopeId: 'B5', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-data-interface-dsl', profileScope: 'batch', scopeId: 'B6', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-batch-build-infra-dsl', profileScope: 'batch', scopeId: 'B7', maxDurationMs: 600000, maxMemoryMb: 3072, maxParserTimePerSegmentMs: 1200, maxUnknownKindRate: 0.015, maxUnresolvedRate: 0.015, blocking: true },
  { laneId: 'lang-framework-canonicalization', profileScope: 'framework', scopeId: 'C4', maxDurationMs: 900000, maxMemoryMb: 4096, maxParserTimePerSegmentMs: 1500, maxUnknownKindRate: 0.02, maxUnresolvedRate: 0.02, blocking: true },
  { laneId: 'lang-smoke', profileScope: 'global', scopeId: 'global', maxDurationMs: 180000, maxMemoryMb: 2048, maxParserTimePerSegmentMs: 800, maxUnknownKindRate: 0.03, maxUnresolvedRate: 0.03, blocking: true }
].sort((a, b) => a.laneId.localeCompare(b.laneId));

const alertPolicies = [
  { id: 'alert-capability-downgrade-rate', metric: 'capability_downgrade_rate', threshold: 0.01, comparator: '>', window: '7d', severity: 'warning', escalationPolicyId: 'usr-oncall-language', blocking: false },
  { id: 'alert-critical-diagnostics', metric: 'critical_diagnostic_count', threshold: 0, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-platform', blocking: true },
  { id: 'alert-lane-duration', metric: 'lane_duration_ms', threshold: 1200000, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-platform', blocking: true },
  { id: 'alert-memory-peak', metric: 'lane_peak_memory_mb', threshold: 4096, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-platform', blocking: true },
  { id: 'alert-redaction-failure', metric: 'redaction_failure_count', threshold: 0, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-security', blocking: true },
  { id: 'alert-unresolved-rate', metric: 'unresolved_reference_rate', threshold: 0.02, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-language', blocking: true },
  { id: 'alert-unknown-kind-rate', metric: 'unknown_kind_rate', threshold: 0.02, comparator: '>', window: 'run', severity: 'critical', escalationPolicyId: 'usr-oncall-language', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const redactionRules = [
  { id: 'redact-auth-token', class: 'auth-token', replacement: '[REDACTED_TOKEN]', appliesTo: ['diagnostic.message', 'node.text', 'report.payload'], blocking: true },
  { id: 'redact-cookie', class: 'cookie', replacement: '[REDACTED_COOKIE]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-email', class: 'email', replacement: '[REDACTED_EMAIL]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-filepath', class: 'filesystem-path-sensitive', replacement: '[REDACTED_PATH]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: false },
  { id: 'redact-ipv4', class: 'ip-address', replacement: '[REDACTED_IP]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-private-key', class: 'private-key-material', replacement: '[REDACTED_KEY]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-session-id', class: 'session-id', replacement: '[REDACTED_SESSION]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true },
  { id: 'redact-url-secret-param', class: 'url-secret-param', replacement: '[REDACTED_PARAM]', appliesTo: ['diagnostic.message', 'report.payload'], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const securityGates = [
  { id: 'security-gate-parser-lock', check: 'parser_runtime_versions_pinned', scope: 'parser', enforcement: 'strict', blocking: true },
  { id: 'security-gate-path-traversal', check: 'path_traversal_rejected', scope: 'path', enforcement: 'strict', blocking: true },
  { id: 'security-gate-redaction-complete', check: 'redaction_rules_applied', scope: 'reporting', enforcement: 'strict', blocking: true },
  { id: 'security-gate-report-size-cap', check: 'report_payload_size_within_cap', scope: 'reporting', enforcement: 'warn', blocking: false },
  { id: 'security-gate-runtime-sandbox', check: 'runtime_exec_disallowed', scope: 'runtime', enforcement: 'strict', blocking: true },
  { id: 'security-gate-schema-no-extension', check: 'strict_schema_unknown_keys_rejected', scope: 'serialization', enforcement: 'strict', blocking: true },
  { id: 'security-gate-symlink-deny', check: 'symlink_escape_denied', scope: 'path', enforcement: 'strict', blocking: true },
  { id: 'security-gate-unsafe-parser-feature', check: 'unsafe_parser_features_disabled', scope: 'parser', enforcement: 'strict', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const runtimeConfigPolicy = [
  { id: 'cfg-fallback-allow-heuristic', key: 'usr.fallback.allowHeuristic', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-framework-enable-overlays', key: 'usr.framework.enableOverlays', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-parser-max-segment-ms', key: 'usr.parser.maxSegmentMs', valueType: 'integer', defaultValue: 1500, minValue: 100, maxValue: 10000, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-parser-selection-mode', key: 'usr.parser.selectionMode', valueType: 'enum', defaultValue: 'deterministic', allowedValues: ['deterministic'], rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: true, blocking: true },
  { id: 'cfg-reporting-emit-raw-parser-kinds', key: 'usr.reporting.emitRawParserKinds', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'warn-unknown', requiresRestart: false, blocking: false },
  { id: 'cfg-risk-interprocedural-enabled', key: 'usr.risk.interproceduralEnabled', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-rollout-cutover-enabled', key: 'usr.rollout.cutoverEnabled', valueType: 'boolean', defaultValue: false, rolloutClass: 'migration-only', strictModeBehavior: 'disallow', requiresRestart: true, blocking: true },
  { id: 'cfg-rollout-shadow-read-enabled', key: 'usr.rollout.shadowReadEnabled', valueType: 'boolean', defaultValue: true, rolloutClass: 'migration-only', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true },
  { id: 'cfg-strict-mode-enabled', key: 'usr.strictMode.enabled', valueType: 'boolean', defaultValue: true, rolloutClass: 'stable', strictModeBehavior: 'disallow', requiresRestart: false, blocking: true }
].sort((a, b) => a.key.localeCompare(b.key));

const failureInjectionMatrix = [
  { id: 'fi-mapping-conflict', faultClass: 'mapping-conflict', injectionLayer: 'normalization', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], requiredReasonCodes: ['USR-R-RESOLUTION-CONFLICT'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-parser-timeout', faultClass: 'parser-timeout', injectionLayer: 'parser', strictExpectedOutcome: 'degrade-with-diagnostics', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-W-CAPABILITY-DOWNGRADED'], requiredReasonCodes: ['USR-R-PARSER-TIMEOUT'], rollbackTriggerConsecutiveFailures: 2, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-parser-unavailable', faultClass: 'parser-unavailable', injectionLayer: 'parser', strictExpectedOutcome: 'degrade-with-diagnostics', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-CAPABILITY-LOST'], requiredReasonCodes: ['USR-R-PARSER-UNAVAILABLE'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-redaction-failure', faultClass: 'redaction-failure', injectionLayer: 'reporting', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SECURITY-GATE-FAILED'], requiredReasonCodes: ['USR-R-REDACTION-REQUIRED'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-resource-budget-breach', faultClass: 'resource-budget-breach', injectionLayer: 'runtime', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SLO-BUDGET-FAILED'], requiredReasonCodes: ['USR-R-RESOURCE-BUDGET-EXCEEDED'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-resolution-ambiguity-overflow', faultClass: 'resolution-ambiguity-overflow', injectionLayer: 'resolution', strictExpectedOutcome: 'degrade-with-diagnostics', nonStrictExpectedOutcome: 'warn-only', requiredDiagnostics: ['USR-W-RESOLUTION-CANDIDATE-CAPPED'], requiredReasonCodes: ['USR-R-CANDIDATE-CAP-EXCEEDED'], rollbackTriggerConsecutiveFailures: 3, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-security-gate-failure', faultClass: 'security-gate-failure', injectionLayer: 'runtime', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SECURITY-GATE-FAILED'], requiredReasonCodes: ['USR-R-SECURITY-GATE-BLOCKED'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true },
  { id: 'fi-serialization-corruption', faultClass: 'serialization-corruption', injectionLayer: 'serialization', strictExpectedOutcome: 'fail-closed', nonStrictExpectedOutcome: 'degrade-with-diagnostics', requiredDiagnostics: ['USR-E-SCHEMA-VIOLATION'], requiredReasonCodes: ['USR-R-SERIALIZATION-INVALID'], rollbackTriggerConsecutiveFailures: 1, requiredRecoveryArtifacts: ['usr-failure-injection-report.json', 'usr-rollback-drill-report.json'], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const fixtureGovernanceSupplementalRows = [
  { fixtureId: 'angular::template-binding::input-output-001', profileType: 'framework', profileId: 'angular', conformanceLevels: ['C4'], families: ['framework-overlay', 'template-binding'], owner: 'framework-angular', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'astro::hydration::island-001', profileType: 'framework', profileId: 'astro', conformanceLevels: ['C4'], families: ['framework-overlay', 'hydration'], owner: 'framework-astro', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'javascript::normalization::jsx-element-001', profileType: 'language', profileId: 'javascript', conformanceLevels: ['C0', 'C1', 'C2'], families: ['normalization', 'golden'], owner: 'language-javascript', reviewers: ['usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'typescript::provenance::transpile-001', profileType: 'language', profileId: 'typescript', conformanceLevels: ['C2', 'C3', 'C4'], families: ['provenance', 'golden'], owner: 'language-typescript', reviewers: ['usr-conformance', 'usr-architecture'], stabilityClass: 'stable', mutationPolicy: 'require-rfc', goldenRequired: true, blocking: true },
  { fixtureId: 'typescript::minimum-slice::vue-module-001', profileType: 'language', profileId: 'typescript', conformanceLevels: ['C0', 'C1', 'C2', 'C3', 'C4'], families: ['minimum-slice', 'golden', 'framework-overlay'], owner: 'language-typescript', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'usr::backcompat::bc-003', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C0', 'C1'], families: ['backcompat', 'negative'], owner: 'usr-rollout', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-rfc', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::integration::cross-language-framework-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C4'], families: ['integration', 'semantic-flow', 'framework-overlay', 'route-semantics', 'template-binding', 'style-scope'], owner: 'usr-conformance', reviewers: ['usr-architecture', 'usr-framework'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'usr::integration::route-template-api-data-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C3', 'C4'], families: ['integration', 'semantic-flow', 'route-semantics', 'template-binding', 'api-boundary', 'data-boundary'], owner: 'usr-conformance', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'usr::failure-injection::parser-lock-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['failure-injection', 'security'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::redaction-fail-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C3'], families: ['failure-injection', 'security', 'reporting'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::resource-budget-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['failure-injection', 'runtime', 'performance'], owner: 'usr-observability', reviewers: ['usr-architecture', 'usr-operations'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::runtime-exec-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2', 'C3'], families: ['failure-injection', 'runtime', 'security'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::failure-injection::security-gate-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['failure-injection', 'security'], owner: 'usr-security', reviewers: ['usr-architecture', 'usr-security'], stabilityClass: 'volatile', mutationPolicy: 'require-review', goldenRequired: false, blocking: true },
  { fixtureId: 'usr::resolution::ambiguous-cap-001', profileType: 'cross-cutting', profileId: 'usr', conformanceLevels: ['C1', 'C2'], families: ['resolution', 'ambiguity'], owner: 'usr-resolution', reviewers: ['usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'allow-generated-refresh', goldenRequired: true, blocking: false },
  { fixtureId: 'vue::minimum-slice::template-style-001', profileType: 'framework', profileId: 'vue', conformanceLevels: ['C4'], families: ['minimum-slice', 'framework-overlay', 'template-binding', 'style-scope'], owner: 'framework-vue', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true },
  { fixtureId: 'vue::template-binding::script-setup-001', profileType: 'framework', profileId: 'vue', conformanceLevels: ['C4'], families: ['framework-overlay', 'template-binding'], owner: 'framework-vue', reviewers: ['usr-architecture', 'usr-conformance'], stabilityClass: 'stable', mutationPolicy: 'require-review', goldenRequired: true, blocking: true }
];

const fixtureGovernance = buildFixtureGovernance({
  languageBaselines,
  frameworkProfiles,
  supplementalRows: fixtureGovernanceSupplementalRows
});

const benchmarkPolicy = [
  { id: 'bench-ci-smoke', laneId: 'ci', datasetClass: 'smoke', hostClass: 'standard-ci', warmupRuns: 1, measureRuns: 5, percentileTargets: { p50DurationMs: 120000, p95DurationMs: 180000, p99DurationMs: 220000 }, maxVariancePct: 12, maxPeakMemoryMb: 2048, blocking: true },
  { id: 'bench-framework-overlay', laneId: 'lang-framework-canonicalization', datasetClass: 'framework-overlay', hostClass: 'standard-ci', warmupRuns: 1, measureRuns: 5, percentileTargets: { p50DurationMs: 300000, p95DurationMs: 450000, p99DurationMs: 540000 }, maxVariancePct: 15, maxPeakMemoryMb: 4096, blocking: true },
  { id: 'bench-lang-batch', laneId: 'ci-long', datasetClass: 'language-batch', hostClass: 'standard-ci-long', warmupRuns: 1, measureRuns: 7, percentileTargets: { p50DurationMs: 600000, p95DurationMs: 900000, p99DurationMs: 1100000 }, maxVariancePct: 18, maxPeakMemoryMb: 6144, blocking: true },
  { id: 'bench-mixed-repo', laneId: 'ci-long', datasetClass: 'mixed-repo', hostClass: 'standard-ci-long', warmupRuns: 2, measureRuns: 9, percentileTargets: { p50DurationMs: 900000, p95DurationMs: 1500000, p99DurationMs: 1800000 }, maxVariancePct: 20, maxPeakMemoryMb: 8192, blocking: false }
].sort((a, b) => a.id.localeCompare(b.id));

const threatModelMatrix = [
  { id: 'threat-path-traversal', threatClass: 'path-traversal', attackSurface: 'input', requiredControls: ['security-gate-path-traversal'], requiredFixtures: ['usr::failure-injection::security-gate-001'], severity: 'critical', blocking: true },
  { id: 'threat-parser-supply-chain', threatClass: 'parser-supply-chain', attackSurface: 'parser', requiredControls: ['security-gate-parser-lock', 'security-gate-unsafe-parser-feature'], requiredFixtures: ['usr::failure-injection::parser-lock-001'], severity: 'high', blocking: true },
  { id: 'threat-reporting-exfiltration', threatClass: 'reporting-exfiltration', attackSurface: 'reporting', requiredControls: ['security-gate-redaction-complete'], requiredFixtures: ['usr::failure-injection::redaction-fail-001'], severity: 'critical', blocking: true },
  { id: 'threat-resource-exhaustion', threatClass: 'resource-exhaustion', attackSurface: 'runtime', requiredControls: ['alert-memory-peak', 'alert-lane-duration'], requiredFixtures: ['usr::failure-injection::resource-budget-001'], severity: 'high', blocking: true },
  { id: 'threat-schema-confusion', threatClass: 'schema-confusion', attackSurface: 'serialization', requiredControls: ['security-gate-schema-no-extension'], requiredFixtures: ['usr::backcompat::bc-003'], severity: 'high', blocking: true },
  { id: 'threat-sensitive-data-leakage', threatClass: 'sensitive-data-leakage', attackSurface: 'reporting', requiredControls: ['redact-auth-token', 'redact-private-key', 'security-gate-redaction-complete'], requiredFixtures: ['usr::failure-injection::redaction-fail-001'], severity: 'critical', blocking: true },
  { id: 'threat-untrusted-execution', threatClass: 'untrusted-execution', attackSurface: 'runtime', requiredControls: ['security-gate-runtime-sandbox'], requiredFixtures: ['usr::failure-injection::runtime-exec-001'], severity: 'critical', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const waiverPolicy = [
  { id: 'waiver-benchmark-overrun-ci-long', waiverClass: 'benchmark-overrun', scopeType: 'lane', scopeId: 'ci-long', allowedUntil: '2026-04-01T00:00:00Z', approvers: ['usr-architecture', 'usr-operations'], requiredCompensatingControls: ['usr-benchmark-regression-summary.json'], maxExtensions: 1, blocking: true },
  { id: 'waiver-non-strict-backcompat-warning', waiverClass: 'non-strict-compat-warning', scopeType: 'artifact', scopeId: 'usr-backcompat-matrix-results', allowedUntil: '2026-04-01T00:00:00Z', approvers: ['usr-rollout', 'usr-architecture'], requiredCompensatingControls: ['usr-waiver-active-report.json'], maxExtensions: 2, blocking: true },
  { id: 'waiver-observability-gap-temp', waiverClass: 'observability-gap', scopeType: 'phase', scopeId: 'phase-10', allowedUntil: '2026-03-15T00:00:00Z', approvers: ['usr-observability', 'usr-operations'], requiredCompensatingControls: ['usr-observability-rollup.json'], maxExtensions: 1, blocking: false },
  { id: 'waiver-temporary-parser-regression', waiverClass: 'temporary-parser-regression', scopeType: 'language', scopeId: 'perl', allowedUntil: '2026-03-20T00:00:00Z', approvers: ['language-perl', 'usr-architecture'], requiredCompensatingControls: ['usr-feature-flag-state.json', 'usr-waiver-expiry-report.json'], maxExtensions: 1, blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const qualityGates = [
  { id: 'qg-framework-binding-f1', domain: 'framework-binding', scopeType: 'global', scopeId: 'global', metric: 'f1', thresholdOperator: '>=', thresholdValue: 0.92, fixtureSetId: 'framework-binding-goldens', blocking: true },
  { id: 'qg-provenance-recall', domain: 'provenance', scopeType: 'global', scopeId: 'global', metric: 'recall', thresholdOperator: '>=', thresholdValue: 0.9, fixtureSetId: 'provenance-goldens', blocking: true },
  { id: 'qg-resolution-precision-ts', domain: 'resolution', scopeType: 'language', scopeId: 'typescript', metric: 'precision', thresholdOperator: '>=', thresholdValue: 0.95, fixtureSetId: 'resolution-typescript-goldens', blocking: true },
  { id: 'qg-risk-false-positive-js', domain: 'risk', scopeType: 'language', scopeId: 'javascript', metric: 'false-positive-rate', thresholdOperator: '<=', thresholdValue: 0.08, fixtureSetId: 'risk-javascript-goldens', blocking: false },
  { id: 'qg-risk-recall-py', domain: 'risk', scopeType: 'language', scopeId: 'python', metric: 'recall', thresholdOperator: '>=', thresholdValue: 0.9, fixtureSetId: 'risk-python-goldens', blocking: true },
  { id: 'qg-vue-template-binding-precision', domain: 'framework-binding', scopeType: 'framework', scopeId: 'vue', metric: 'precision', thresholdOperator: '>=', thresholdValue: 0.93, fixtureSetId: 'framework-vue-template-goldens', blocking: true },
  { id: 'qg-min-slice-typescript-vue', domain: 'minimum-slice', scopeType: 'framework', scopeId: 'vue', metric: 'pass-rate', thresholdOperator: '>=', thresholdValue: 1.0, fixtureSetId: 'minimum-slice-typescript-vue', blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const operationalReadinessPolicy = [
  { id: 'ops-cutover-window', phase: 'cutover', runbookId: 'usr-cutover-runbook', severityClass: 'n/a', requiredRoles: ['usr-architecture', 'usr-operations', 'usr-release-manager'], requiredArtifacts: ['usr-release-readiness-scorecard.json', 'usr-waiver-active-report.json'], communicationChannels: ['release-bridge', 'status-page'], maxResponseMinutes: 15, maxRecoveryMinutes: 60, blocking: true },
  { id: 'ops-incident-critical', phase: 'incident', runbookId: 'usr-incident-critical-runbook', severityClass: 'sev1', requiredRoles: ['usr-oncall-platform', 'usr-oncall-security'], requiredArtifacts: ['usr-incident-response-drill-report.json'], communicationChannels: ['incident-bridge', 'security-hotline'], maxResponseMinutes: 10, maxRecoveryMinutes: 120, blocking: true },
  { id: 'ops-post-cutover-review', phase: 'post-cutover', runbookId: 'usr-post-cutover-review-runbook', severityClass: 'n/a', requiredRoles: ['usr-operations', 'usr-conformance'], requiredArtifacts: ['usr-observability-rollup.json', 'usr-quality-regression-report.json'], communicationChannels: ['release-review'], maxResponseMinutes: 60, maxRecoveryMinutes: 240, blocking: false },
  { id: 'ops-pre-cutover-checklist', phase: 'pre-cutover', runbookId: 'usr-pre-cutover-checklist', severityClass: 'n/a', requiredRoles: ['usr-architecture', 'usr-rollout'], requiredArtifacts: ['usr-operational-readiness-validation.json', 'usr-rollback-drill-report.json'], communicationChannels: ['release-planning'], maxResponseMinutes: 30, maxRecoveryMinutes: 180, blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const ownershipMatrix = [
  { id: 'own-core-artifacts', domain: 'artifact-schema-catalog', ownerRole: 'usr-architecture', backupOwnerRole: 'usr-conformance', escalationPolicyId: 'esc-contract-conflict', evidenceArtifacts: ['usr-validation-report.json'], blocking: true },
  { id: 'own-diagnostics-taxonomy', domain: 'diagnostics-reasoncodes', ownerRole: 'usr-conformance', backupOwnerRole: 'usr-architecture', escalationPolicyId: 'esc-taxonomy-drift', evidenceArtifacts: ['usr-validation-report.json', 'usr-conformance-summary.json'], blocking: true },
  { id: 'own-framework-profiles', domain: 'language-framework-catalog', ownerRole: 'usr-framework', backupOwnerRole: 'usr-architecture', escalationPolicyId: 'esc-framework-contract-conflict', evidenceArtifacts: ['usr-conformance-summary.json', 'usr-quality-evaluation-results.json'], blocking: true },
  { id: 'own-security-governance', domain: 'security-risk-compliance', ownerRole: 'usr-security', backupOwnerRole: 'usr-operations', escalationPolicyId: 'esc-security-gate-failure', evidenceArtifacts: ['usr-threat-model-coverage-report.json', 'usr-failure-injection-report.json'], blocking: true },
  { id: 'own-observability-slo', domain: 'observability-performance-ops', ownerRole: 'usr-observability', backupOwnerRole: 'usr-operations', escalationPolicyId: 'esc-slo-budget-breach', evidenceArtifacts: ['usr-observability-rollup.json', 'usr-benchmark-summary.json'], blocking: true }
].sort((a, b) => a.id.localeCompare(b.id));

const escalationPolicy = [
  { id: 'esc-contract-conflict', triggerClass: 'contract-conflict', severity: 'high', requiredApprovers: ['usr-architecture', 'usr-release-manager'], maxAckMinutes: 60, maxResolutionMinutes: 240, autoBlockPromotion: true },
  { id: 'esc-framework-contract-conflict', triggerClass: 'framework-conflict', severity: 'high', requiredApprovers: ['usr-framework', 'usr-architecture'], maxAckMinutes: 45, maxResolutionMinutes: 180, autoBlockPromotion: true },
  { id: 'esc-security-gate-failure', triggerClass: 'security-gate-failure', severity: 'critical', requiredApprovers: ['usr-security', 'usr-oncall-platform'], maxAckMinutes: 15, maxResolutionMinutes: 120, autoBlockPromotion: true },
  { id: 'esc-slo-budget-breach', triggerClass: 'slo-budget-breach', severity: 'high', requiredApprovers: ['usr-observability', 'usr-operations'], maxAckMinutes: 30, maxResolutionMinutes: 180, autoBlockPromotion: true },
  { id: 'esc-taxonomy-drift', triggerClass: 'taxonomy-drift', severity: 'medium', requiredApprovers: ['usr-conformance', 'usr-architecture'], maxAckMinutes: 120, maxResolutionMinutes: 720, autoBlockPromotion: false }
].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Resolve embedding policy for one language, with language-level overrides.
 *
 * Derivation rule:
 * - Language-specific policy always wins.
 * - Otherwise, fallback is family-driven (`markup` can host embeds, style/data
 *   families can only be embedded, all others are non-embedding by default).
 *
 * @param {string} languageId
 * @param {string} family
 * @returns {{canHostEmbedded:boolean,canBeEmbedded:boolean,embeddedLanguageAllowlist:string[]}}
 */
function embeddingPolicyFor(languageId, family) {
  if (customEmbeddingPolicies[languageId]) {
    return customEmbeddingPolicies[languageId];
  }
  if (family === 'markup') {
    return { canHostEmbedded: true, canBeEmbedded: true, embeddedLanguageAllowlist: ['css', 'javascript'] };
  }
  if (family === 'style' || family === 'data-interface' || family === 'config-data') {
    return { canHostEmbedded: false, canBeEmbedded: true, embeddedLanguageAllowlist: [] };
  }
  return { canHostEmbedded: false, canBeEmbedded: false, embeddedLanguageAllowlist: [] };
}

const HIGH_SIGNAL_RISK_FAMILIES = new Set(['dynamic', 'js-ts', 'managed', 'systems']);
const BLOCKING_CAPABILITIES = new Set(['ast', 'docmeta', 'symbolGraph']);
const CAPABILITY_NO_DIAGNOSTICS = [];
const CAPABILITY_DOWNGRADED_DIAGNOSTICS = ['USR-W-CAPABILITY-DOWNGRADED'];
const CAPABILITY_LOST_DIAGNOSTICS = ['USR-E-CAPABILITY-LOST'];
const SORTED_CAPABILITIES = [...CAPABILITIES].sort();
const RISK_REQUIRED_SANITIZERS = ['allowlist', 'context-escape', 'parameterization'];
const RISK_OPTIONAL_SOURCES = ['config-input'];
const RISK_OPTIONAL_SINKS = ['logging-sink'];
const RISK_OPTIONAL_SANITIZERS = ['encoding-normalization'];
const RISK_UNSUPPORTED_SANITIZERS = [];
const RISK_MIN_EVIDENCE_KINDS = ['calls', 'references'];
const RISK_SEVERITY_LEVELS = ['info', 'low', 'medium', 'high', 'critical'];
const RISK_SOURCES_HIGH_SIGNAL = ['environment-input', 'external-input'];
const RISK_SOURCES_LOW_SIGNAL = ['template-input'];
const RISK_SINKS_HIGH_SIGNAL = ['command-exec', 'filesystem-write', 'network-egress'];
const RISK_SINKS_LOW_SIGNAL = ['template-render'];
const RISK_INTERPROCEDURAL_UNSUPPORTED_SOURCES = ['interprocedural-source'];
const RISK_INTERPROCEDURAL_UNSUPPORTED_SINKS = ['interprocedural-sink'];

export {
  SCHEMA_VERSION,
  CAPABILITIES,
  languageBaselines,
  familyNodeKinds,
  familyEdgeKinds,
  familyCapabilities,
  parserFallbackByPreference,
  customEmbeddingPolicies,
  frameworkProfiles,
  frameworkEdgeCases,
  edgeKindConstraints,
  nodeKindMappings,
  backcompatMatrix,
  embeddingBridgeCases,
  generatedProvenanceCases,
  parserRuntimeLocks,
  sloBudgets,
  alertPolicies,
  redactionRules,
  securityGates,
  runtimeConfigPolicy,
  failureInjectionMatrix,
  fixtureGovernance,
  benchmarkPolicy,
  threatModelMatrix,
  waiverPolicy,
  qualityGates,
  operationalReadinessPolicy,
  ownershipMatrix,
  escalationPolicy,
  embeddingPolicyFor,
  HIGH_SIGNAL_RISK_FAMILIES,
  BLOCKING_CAPABILITIES,
  CAPABILITY_NO_DIAGNOSTICS,
  CAPABILITY_DOWNGRADED_DIAGNOSTICS,
  CAPABILITY_LOST_DIAGNOSTICS,
  SORTED_CAPABILITIES,
  RISK_REQUIRED_SANITIZERS,
  RISK_OPTIONAL_SOURCES,
  RISK_OPTIONAL_SINKS,
  RISK_OPTIONAL_SANITIZERS,
  RISK_UNSUPPORTED_SANITIZERS,
  RISK_MIN_EVIDENCE_KINDS,
  RISK_SEVERITY_LEVELS,
  RISK_SOURCES_HIGH_SIGNAL,
  RISK_SOURCES_LOW_SIGNAL,
  RISK_SINKS_HIGH_SIGNAL,
  RISK_SINKS_LOW_SIGNAL,
  RISK_INTERPROCEDURAL_UNSUPPORTED_SOURCES,
  RISK_INTERPROCEDURAL_UNSUPPORTED_SINKS
};
