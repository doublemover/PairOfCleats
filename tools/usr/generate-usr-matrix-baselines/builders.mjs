import path from 'node:path';
import {
  SCHEMA_VERSION,
  languageBaselines,
  familyNodeKinds,
  familyEdgeKinds,
  familyCapabilities,
  parserFallbackByPreference,
  frameworkProfiles,
  nodeKindMappings,
  edgeKindConstraints,
  backcompatMatrix,
  frameworkEdgeCases,
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
} from './datasets.mjs';

/**
 * Normalize one raw baseline row into deterministic registry-ready shape.
 *
 * Invariants:
 * - Source arrays are pre-canonicalized in dataset catalogs; this function
 *   copies those arrays without re-sorting to avoid per-run sort overhead.
 * - `requiredCapabilities` and parser fallback chains are resolved from family
 *   and parser preference catalogs; missing catalog entries are a programmer error.
 * - Risk source/sink expectations are derived from family signal class and must
 *   remain aligned with `HIGH_SIGNAL_RISK_FAMILIES`.
 *
 * @param {{
 *   id:string,
 *   family:string,
 *   parserPreference:string,
 *   requiredConformance:string[],
 *   frameworkProfiles:string[],
 *   minVersion:string,
 *   dialects:string[],
 *   featureFlags:string[]
 * }} base
 * @returns {object}
 */
function normalizeLanguageBaseline(base) {
  const embeddingPolicy = embeddingPolicyFor(base.id, base.family);
  const isHighSignal = HIGH_SIGNAL_RISK_FAMILIES.has(base.family);
  const riskInterprocedural = isHighSignal ? 'partial' : 'unsupported';
  return {
    id: base.id,
    family: base.family,
    parserPreference: base.parserPreference,
    requiredConformance: [...base.requiredConformance],
    frameworkProfiles: [...base.frameworkProfiles],
    languageVersionPolicy: {
      minVersion: base.minVersion,
      maxVersion: null,
      dialects: [...base.dialects],
      featureFlags: [...base.featureFlags]
    },
    embeddingPolicy: {
      canHostEmbedded: embeddingPolicy.canHostEmbedded,
      canBeEmbedded: embeddingPolicy.canBeEmbedded,
      embeddedLanguageAllowlist: [...embeddingPolicy.embeddedLanguageAllowlist]
    },
    requiredNodeKinds: [...familyNodeKinds[base.family]],
    requiredEdgeKinds: [...familyEdgeKinds[base.family]],
    requiredCapabilities: familyCapabilities[base.family],
    fallbackChain: parserFallbackByPreference[base.parserPreference],
    riskLocal: isHighSignal ? 'supported' : 'partial',
    riskInterprocedural,
    requiredRiskSources: isHighSignal ? RISK_SOURCES_HIGH_SIGNAL : RISK_SOURCES_LOW_SIGNAL,
    requiredRiskSinks: isHighSignal ? RISK_SINKS_HIGH_SIGNAL : RISK_SINKS_LOW_SIGNAL,
    unsupportedRiskSources: riskInterprocedural === 'unsupported' ? RISK_INTERPROCEDURAL_UNSUPPORTED_SOURCES : CAPABILITY_NO_DIAGNOSTICS,
    unsupportedRiskSinks: riskInterprocedural === 'unsupported' ? RISK_INTERPROCEDURAL_UNSUPPORTED_SINKS : CAPABILITY_NO_DIAGNOSTICS
  };
}

function normalizeLanguageBaselines() {
  return languageBaselines
    .map((base) => normalizeLanguageBaseline(base))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function languageProfileRows(normalizedLanguages) {
  return normalizedLanguages.map((language) => ({
    id: language.id,
    parserPreference: language.parserPreference,
    languageVersionPolicy: language.languageVersionPolicy,
    embeddingPolicy: language.embeddingPolicy,
    requiredNodeKinds: language.requiredNodeKinds,
    requiredEdgeKinds: language.requiredEdgeKinds,
    requiredCapabilities: language.requiredCapabilities,
    fallbackChain: language.fallbackChain,
    frameworkProfiles: language.frameworkProfiles,
    requiredConformance: language.requiredConformance,
    notes: `Baseline ${language.family} profile.`
  }));
}

function languageVersionPolicyRows(normalizedLanguages) {
  return normalizedLanguages.map((language) => ({
    languageId: language.id,
    minVersion: language.languageVersionPolicy.minVersion,
    maxVersion: language.languageVersionPolicy.maxVersion,
    dialects: language.languageVersionPolicy.dialects,
    featureFlags: language.languageVersionPolicy.featureFlags
  }));
}

function languageEmbeddingPolicyRows(normalizedLanguages) {
  return normalizedLanguages.map((language) => ({
    languageId: language.id,
    canHostEmbedded: language.embeddingPolicy.canHostEmbedded,
    canBeEmbedded: language.embeddingPolicy.canBeEmbedded,
    embeddedLanguageAllowlist: language.embeddingPolicy.embeddedLanguageAllowlist
  }));
}

function capabilityRows(normalizedLanguages) {
  const rows = [];
  for (const language of normalizedLanguages) {
    for (const capability of SORTED_CAPABILITIES) {
      const state = language.requiredCapabilities[capability];
      const downgradeDiagnostics = state === 'supported'
        ? CAPABILITY_NO_DIAGNOSTICS
        : state === 'partial'
          ? CAPABILITY_DOWNGRADED_DIAGNOSTICS
          : CAPABILITY_LOST_DIAGNOSTICS;
      rows.push({
        languageId: language.id,
        frameworkProfile: null,
        capability,
        state,
        requiredConformance: language.requiredConformance,
        downgradeDiagnostics,
        blocking: state === 'unsupported' && BLOCKING_CAPABILITIES.has(capability)
      });
    }
  }
  return rows;
}

/**
 * Build conformance requirements for framework/language profiles.
 *
 * Framework profiles are already exported in canonical `id` order from
 * dataset catalogs, so this routine preserves that order directly.
 *
 * @param {object[]} normalizedLanguages
 * @returns {object[]}
 */
function conformanceRows(normalizedLanguages) {
  const frameworkRows = frameworkProfiles.map((profile) => {
      const requiredFixtureFamilies = ['framework-overlay', 'embedded-bridge'];
      if (profile.routeSemantics?.enabled) {
        requiredFixtureFamilies.push('route-canonicalization');
      }
      if (profile.hydrationSemantics?.required) {
        requiredFixtureFamilies.push('hydration');
      }
      return {
        profileType: 'framework',
        profileId: profile.id,
        requiredLevels: ['C4'],
        blockingLevels: ['C4'],
        requiredFixtureFamilies
      };
    });

  const languageRows = normalizedLanguages.map((language) => {
    const requiredFixtureFamilies = ['golden', 'normalization', 'resolution', 'risk'];
    if (language.frameworkProfiles.length > 0) {
      requiredFixtureFamilies.push('framework-overlay');
    }
    return {
      profileType: 'language',
      profileId: language.id,
      requiredLevels: language.requiredConformance,
      blockingLevels: language.requiredConformance,
      requiredFixtureFamilies
    };
  });

  return [...frameworkRows, ...languageRows];
}

function riskRows(normalizedLanguages) {
  return normalizedLanguages.map((language) => ({
    languageId: language.id,
    frameworkProfile: null,
    required: {
      sources: language.requiredRiskSources,
      sinks: language.requiredRiskSinks,
      sanitizers: RISK_REQUIRED_SANITIZERS
    },
    optional: {
      sources: RISK_OPTIONAL_SOURCES,
      sinks: RISK_OPTIONAL_SINKS,
      sanitizers: RISK_OPTIONAL_SANITIZERS
    },
    unsupported: {
      sources: language.unsupportedRiskSources,
      sinks: language.unsupportedRiskSinks,
      sanitizers: RISK_UNSUPPORTED_SANITIZERS
    },
    capabilities: {
      riskLocal: language.riskLocal,
      riskInterprocedural: language.riskInterprocedural
    },
    interproceduralGating: {
      enabledByDefault: language.riskInterprocedural !== 'unsupported',
      minEvidenceKinds: RISK_MIN_EVIDENCE_KINDS,
      requiredCallLinkConfidence: 0.7
    },
    severityPolicy: {
      levels: RISK_SEVERITY_LEVELS,
      defaultLevel: 'medium'
    }
  }));
}

/**
 * Build canonical payload envelope for one registry document.
 *
 * @param {string} registryId
 * @param {object[]} rows
 * @returns {{schemaVersion:string,registryId:string,rows:object[]}}
 */
function buildRegistryPayload(registryId, rows) {
  return {
    schemaVersion: SCHEMA_VERSION,
    registryId,
    rows
  };
}

/**
 * Build all registry records (id/path/serialized JSON) for current baselines.
 *
 * The order of `registryRows` is part of the generated artifact contract and
 * should stay append-only unless a deliberate registry migration is performed.
 *
 * @param {object[]} normalizedLanguages
 * @param {string} matrixDir
 * @returns {{registryId:string,filePath:string,serialized:string}[]}
 */
function buildRegistryRecords(normalizedLanguages, matrixDir) {
  const languageProfiles = languageProfileRows(normalizedLanguages);
  const registryRows = [
    ['usr-language-profiles', languageProfiles],
    ['usr-language-version-policy', languageVersionPolicyRows(normalizedLanguages)],
    ['usr-language-embedding-policy', languageEmbeddingPolicyRows(normalizedLanguages)],
    ['usr-framework-profiles', frameworkProfiles],
    ['usr-node-kind-mapping', nodeKindMappings],
    ['usr-edge-kind-constraints', edgeKindConstraints],
    ['usr-capability-matrix', capabilityRows(normalizedLanguages)],
    ['usr-conformance-levels', conformanceRows(normalizedLanguages)],
    ['usr-backcompat-matrix', backcompatMatrix],
    ['usr-framework-edge-cases', frameworkEdgeCases],
    ['usr-language-risk-profiles', riskRows(normalizedLanguages)],
    ['usr-embedding-bridge-cases', embeddingBridgeCases],
    ['usr-generated-provenance-cases', generatedProvenanceCases],
    ['usr-parser-runtime-lock', parserRuntimeLocks],
    ['usr-slo-budgets', sloBudgets],
    ['usr-alert-policies', alertPolicies],
    ['usr-redaction-rules', redactionRules],
    ['usr-security-gates', securityGates],
    ['usr-runtime-config-policy', runtimeConfigPolicy],
    ['usr-failure-injection-matrix', failureInjectionMatrix],
    ['usr-fixture-governance', fixtureGovernance],
    ['usr-benchmark-policy', benchmarkPolicy],
    ['usr-threat-model-matrix', threatModelMatrix],
    ['usr-waiver-policy', waiverPolicy],
    ['usr-quality-gates', qualityGates],
    ['usr-operational-readiness-policy', operationalReadinessPolicy],
    ['usr-ownership-matrix', ownershipMatrix],
    ['usr-escalation-policy', escalationPolicy]
  ];
  return registryRows.map(([registryId, rows]) => {
    const payload = buildRegistryPayload(registryId, rows);
    return {
      registryId,
      filePath: path.join(matrixDir, `${registryId}.json`),
      serialized: `${JSON.stringify(payload, null, 2)}\n`
    };
  });
}

/**
 * Assert bidirectional consistency between language and framework applicability.
 *
 * Invariant: language -> framework and framework -> language declarations must
 * be exact mirrors. Any one-sided declaration fails fast because it silently
 * invalidates C4 coverage matrices and fixture governance assumptions.
 *
 * @returns {void}
 */
function assertLanguageFrameworkApplicability() {
  const appliesByFramework = new Map(
    frameworkProfiles.map((profile) => [profile.id, new Set(profile.appliesToLanguages)])
  );
  const frameworksByLanguage = new Map(
    languageBaselines.map((language) => [language.id, new Set(language.frameworkProfiles)])
  );

  for (const language of languageBaselines) {
    for (const frameworkId of language.frameworkProfiles) {
      const applies = appliesByFramework.get(frameworkId);
      if (!applies) {
        throw new Error(`Unknown framework profile in language baseline: language=${language.id} framework=${frameworkId}`);
      }
      if (!applies.has(language.id)) {
        throw new Error(`Inconsistent language/framework applicability: language=${language.id} framework=${frameworkId}`);
      }
    }
  }

  for (const framework of frameworkProfiles) {
    for (const languageId of framework.appliesToLanguages) {
      const frameworkSet = frameworksByLanguage.get(languageId);
      if (!frameworkSet) {
        throw new Error(`Unknown language in framework applicability: framework=${framework.id} language=${languageId}`);
      }
      if (!frameworkSet.has(framework.id)) {
        throw new Error(`Missing framework in language baseline: framework=${framework.id} language=${languageId}`);
      }
    }
  }
}

export {
  normalizeLanguageBaseline,
  normalizeLanguageBaselines,
  languageProfileRows,
  languageVersionPolicyRows,
  languageEmbeddingPolicyRows,
  capabilityRows,
  conformanceRows,
  riskRows,
  buildRegistryPayload,
  buildRegistryRecords,
  assertLanguageFrameworkApplicability
};
