import { matchGeneratedExpectationSpecifier } from '../../specifier-hints.js';
import { normalizeImportSpecifier, normalizeRelPath } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';

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

export const createGeneratedArtifactsPlugin = ({
  expectedArtifactsIndex = null,
  config = null
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
