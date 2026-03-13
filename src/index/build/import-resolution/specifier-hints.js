import path from 'node:path';

const SCHEME_RELATIVE_URL_RX = /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/i;
const BAZEL_LOCAL_LABEL_RX = /^:([\w.+~/-]+)$/;
const BAZEL_WORKSPACE_LABEL_RX = /^\/\/([\w.+~/-]*)(?::([\w.+~/-]+))?$/;
const BAZEL_EXTERNAL_LABEL_RX = /^@([\w.+~/-]+)(?:\/\/([\w.+~/-]*)(?::([\w.+~/-]+))?)?$/;
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

const normalizeBazelPackage = (value) => {
  const normalized = normalizeHint(value).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return '';
  return normalized;
};

const normalizeBazelTarget = (value) => {
  const normalized = normalizeHint(value).replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized || '';
};

const resolveBazelDefaultTarget = (pkg) => {
  if (!pkg) return '';
  const base = path.posix.basename(pkg);
  return base && base !== '.' ? base : '';
};

export const parseBazelLabelSpecifier = (value, { importerRel = '' } = {}) => {
  const normalized = normalizeHint(value);
  if (!normalized || SCHEME_RELATIVE_URL_RX.test(normalized)) return null;

  const localMatch = normalized.match(BAZEL_LOCAL_LABEL_RX);
  if (localMatch) {
    const target = normalizeBazelTarget(localMatch[1]);
    if (!target) return null;
    const importerNorm = normalizeHint(importerRel);
    const packageRel = importerNorm ? normalizeBazelPackage(path.posix.dirname(importerNorm)) : '';
    return {
      label: normalized,
      kind: 'local',
      repo: null,
      package: packageRel,
      target
    };
  }

  const workspaceMatch = normalized.match(BAZEL_WORKSPACE_LABEL_RX);
  if (workspaceMatch) {
    const packageRel = normalizeBazelPackage(workspaceMatch[1]);
    const target = normalizeBazelTarget(workspaceMatch[2]) || resolveBazelDefaultTarget(packageRel);
    return {
      label: normalized,
      kind: 'workspace',
      repo: null,
      package: packageRel,
      target
    };
  }

  const externalMatch = normalized.match(BAZEL_EXTERNAL_LABEL_RX);
  if (externalMatch) {
    const repo = normalizeHint(externalMatch[1]);
    if (!repo) return null;
    const packageRel = normalizeBazelPackage(externalMatch[2]);
    const target = normalizeBazelTarget(externalMatch[3]) || resolveBazelDefaultTarget(packageRel);
    return {
      label: normalized,
      kind: 'external',
      repo,
      package: packageRel,
      target
    };
  }

  return null;
};

export const isBazelLabelSpecifier = (value) => {
  return parseBazelLabelSpecifier(value) !== null;
};

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
