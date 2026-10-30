import { sha1 } from '../shared/hash.js';
import { stableStringifyForSignature } from '../shared/stable-json.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from './semantic/analysis-versions.js';

const policyReceipts = new WeakMap();

export const recordRiskRulesPolicyReceipt = bundle => {
  const receipt = Object.freeze({ schemaVersion: 1, producerVersion: SEMANTIC_ANALYSIS_VERSIONS.riskPropagation,
    effectiveFingerprint: buildRiskRulesBundleFingerprint(bundle) });
  policyReceipts.set(bundle, receipt);
  return receipt;
};

/** Normalized runtime bundles qualify once; projected worker bundles retain the
 * same serialized policy/provenance without re-opening a configured pathname. */
export const getRiskRulesPolicyReceipt = bundle => {
  if (!bundle || typeof bundle !== 'object') return null;
  const admitted = policyReceipts.get(bundle);
  return admitted || Object.freeze({ schemaVersion: 1, producerVersion: SEMANTIC_ANALYSIS_VERSIONS.riskPropagation,
    effectiveFingerprint: buildRiskRulesBundleFingerprint(bundle) });
};


const serializePattern = (pattern) => {
  if (!pattern) return null;
  if (typeof pattern === 'string') return pattern;
  if (typeof pattern.source === 'string') return pattern.source;
  return null;
};

const serializeRule = (rule) => ({
  id: typeof rule?.id === 'string' ? rule.id : null,
  type: typeof rule?.type === 'string' ? rule.type : null,
  name: typeof rule?.name === 'string' ? rule.name : null,
  category: typeof rule?.category === 'string' ? rule.category : null,
  severity: typeof rule?.severity === 'string' ? rule.severity : null,
  tags: Array.isArray(rule?.tags) ? rule.tags.filter(Boolean) : [],
  confidence: Number.isFinite(rule?.confidence) ? rule.confidence : null,
  languages: Array.isArray(rule?.languages) ? rule.languages.filter(Boolean) : null,
  patterns: Array.isArray(rule?.patterns)
    ? rule.patterns.map(serializePattern).filter(Boolean)
    : [],
  requires: rule?.requires ? serializePattern(rule.requires) : null
});

const fingerprintSerializedRiskRulesBundle = (serializedBundle) => {
  if (!serializedBundle || typeof serializedBundle !== 'object') return null;
  return `sha1:${sha1(stableStringifyForSignature(serializedBundle))}`;
};

export const buildRiskRulesBundleFingerprint = (bundle) => {
  if (!bundle || typeof bundle !== 'object') return null;
  const serialized = serializeRiskRulesBundle(bundle);
  return serialized?.fingerprint || null;
};

export const serializeRiskRulesBundle = (bundle) => {
  if (!bundle || typeof bundle !== 'object') return null;
  const serialized = {
    version: typeof bundle.version === 'string' ? bundle.version : '1.0.0',
    sources: Array.isArray(bundle.sources) ? bundle.sources.map(serializeRule) : [],
    sinks: Array.isArray(bundle.sinks) ? bundle.sinks.map(serializeRule) : [],
    sanitizers: Array.isArray(bundle.sanitizers) ? bundle.sanitizers.map(serializeRule) : [],
    regexConfig: bundle.regexConfig || null,
    diagnostics: bundle.diagnostics || null,
    provenance: bundle.provenance || null,
    inputReceipt: bundle.inputReceipt || null,
    producerVersion: bundle.producerVersion || null
  };
  return {
    ...serialized,
    fingerprint: fingerprintSerializedRiskRulesBundle(serialized)
  };
};
