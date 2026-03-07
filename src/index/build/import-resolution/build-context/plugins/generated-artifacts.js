import { matchGeneratedExpectationSpecifier } from '../../specifier-hints.js';
import { toSpecifierCandidatePaths } from '../../candidate-paths.js';
import { normalizeImportSpecifier, normalizeRelPath } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';
import { resolveGeneratedPolicyDecision } from '../../../generated-policy.js';

const normalizeTextToken = (value) => (
  typeof value === 'string'
    ? value.trim().replace(/\\/g, '/')
    : ''
);

const normalizeTokenArray = (value) => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => normalizeTextToken(entry).toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized)).sort();
};

const normalizeSuffixArray = (value) => {
  const normalized = normalizeTokenArray(value)
    .map((entry) => (entry.startsWith('.') || entry.startsWith('_') ? entry : `.${entry}`));
  return Array.from(new Set(normalized)).sort();
};

const hasCustomGeneratedMatch = ({
  importer = '',
  specifier = '',
  customSegments = [],
  customTokens = [],
  customSuffixes = []
} = {}) => {
  const importerNorm = normalizeRelPath(importer).toLowerCase();
  const specifierNorm = normalizeTextToken(specifier).toLowerCase();
  if (!importerNorm && !specifierNorm) return false;
  const segmentHit = customSegments.some((segment) => (
    importerNorm.includes(segment) || specifierNorm.includes(segment)
  ));
  if (segmentHit) return true;
  const tokenHit = customTokens.some((token) => specifierNorm.includes(token));
  if (tokenHit) return true;
  return customSuffixes.some((suffix) => specifierNorm.endsWith(suffix));
};

const stableSerializedConfig = (config) => JSON.stringify({
  segments: config.customSegments,
  tokens: config.customTokens,
  suffixes: config.customSuffixes
});

const resolveGeneratedPolicyMatch = ({
  generatedPolicy = null,
  importerRel = '',
  targetSpecifier = '',
  rawSpec = ''
} = {}) => {
  const candidates = toSpecifierCandidatePaths({
    importer: importerRel,
    specifier: targetSpecifier || rawSpec
  });
  for (const candidate of candidates) {
    const decision = resolveGeneratedPolicyDecision({
      generatedPolicy,
      relPath: candidate
    });
    if (!decision) continue;
    if (decision.downgrade !== true) {
      return {
        matched: false,
        blockedByInclude: true
      };
    }
    return {
      matched: true,
      source: 'generated-policy',
      matchType: decision.classification || 'generated',
      candidate,
      classification: decision.classification || 'generated',
      decisionSource: decision.source || 'explicit-policy'
    };
  }
  return {
    matched: false,
    blockedByInclude: false
  };
};

export const createGeneratedArtifactsPlugin = ({
  expectedArtifactsIndex = null,
  config = null,
  generatedPolicy = null
} = {}) => {
  const generatedConfig = config && typeof config === 'object' ? config : {};
  const customSegments = normalizeTokenArray(generatedConfig.segments);
  const customTokens = normalizeTokenArray(generatedConfig.tokens);
  const customSuffixes = normalizeSuffixArray(generatedConfig.suffixes);
  const configFingerprint = stableSerializedConfig({
    customSegments,
    customTokens,
    customSuffixes
  });

  const classify = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
    const targetSpecifier = normalizeImportSpecifier(spec || rawSpec);
    const generatedMatch = matchGeneratedExpectationSpecifier({
      importer: importerRel,
      specifier: targetSpecifier,
      expectedArtifactsIndex
    });
    if (generatedMatch?.matched) {
      return {
        reasonCode: IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING,
        pluginId: 'generated-artifacts',
        match: generatedMatch
      };
    }
    const generatedPolicyMatch = resolveGeneratedPolicyMatch({
      generatedPolicy,
      importerRel,
      targetSpecifier,
      rawSpec
    });
    if (generatedPolicyMatch?.matched) {
      return {
        reasonCode: IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING,
        pluginId: 'generated-artifacts',
        match: generatedPolicyMatch
      };
    }
    if (generatedPolicyMatch?.blockedByInclude) {
      return null;
    }
    if (hasCustomGeneratedMatch({
      importer: importerRel,
      specifier: targetSpecifier || rawSpec,
      customSegments,
      customTokens,
      customSuffixes
    })) {
      return {
        reasonCode: IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING,
        pluginId: 'generated-artifacts',
        match: {
          matched: true,
          source: 'plugin-config',
          matchType: 'custom_hint'
        }
      };
    }
    return null;
  };

  return Object.freeze({
    id: 'generated-artifacts',
    priority: 20,
    fingerprint: [
      `index=${expectedArtifactsIndex?.fingerprint || 'none'}`,
      `config=${configFingerprint}`
    ].join('|'),
    classify
  });
};
