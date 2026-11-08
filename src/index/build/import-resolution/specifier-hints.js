import { admitBazelLabel } from './bazel-label.js';
import path from 'node:path';

const GENERATED_SEGMENT_HINTS = Object.freeze([
  '/generated/',
  '/gen/',
  '/__generated__/'
]);
const GENERATED_TOKEN_HINTS = Object.freeze([
  '.generated.',
  '.gen.',
  '_generated',
  '.pb.',
  '.g.dart',
  '.designer.'
]);

const normalizeHint = (value) => (
  typeof value === 'string'
    ? value.trim().replace(/\\/g, '/')
    : ''
);

export const parseBazelLabelSpecifier = (value, options = {}) => {
  const admitted = admitBazelLabel(value, { importerRel: 'BUILD', ...options });
  return admitted.state === 'accepted' ? admitted : null;
};
export const isBazelLabelSpecifier = (value, options = {}) => admitBazelLabel(value, { importerRel: 'BUILD', ...options }).state !== 'not-label';

export const matchGeneratedExpectationSpecifier = ({
  importer = '',
  specifier = '',
  expectedArtifactsIndex = null
} = {}) => {
  const indexMatch = expectedArtifactsIndex && typeof expectedArtifactsIndex.match === 'function'
    ? expectedArtifactsIndex.match({ importer, specifier })
    : null;
  if (indexMatch?.matched) return indexMatch;
  const normalizedImporter = normalizeHint(importer).toLowerCase();
  const normalizedSpecifier = normalizeHint(specifier).toLowerCase();
  if (!normalizedImporter && !normalizedSpecifier) {
    return {
      matched: false,
      source: 'none',
      matchType: null
    };
  }
  const importerHit = GENERATED_SEGMENT_HINTS.some((hint) => normalizedImporter.includes(hint));
  const specifierSegmentHit = GENERATED_SEGMENT_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  const specifierTokenHit = GENERATED_TOKEN_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  if (importerHit || specifierSegmentHit || specifierTokenHit) {
    return {
      matched: true,
      source: 'heuristic',
      matchType: 'token_hint'
    };
  }
  return {
    matched: false,
    source: 'none',
    matchType: null
  };
};

export const isGeneratedExpectationSpecifier = ({
  importer = '',
  specifier = '',
  expectedArtifactsIndex = null
} = {}) => {
  const match = matchGeneratedExpectationSpecifier({
    importer,
    specifier,
    expectedArtifactsIndex
  });
  return match.matched === true;
};
