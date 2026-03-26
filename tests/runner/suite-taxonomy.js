const META_PREFIXES = Object.freeze([
  'ci/',
  'runner/',
  'tooling/ci/',
  'tooling/config-inventory/',
  'tooling/docs/',
  'tooling/script-coverage/'
]);

const META_IDS = Object.freeze(new Set([
  'tooling/editors/harness-coverage'
]));

const HERO_PREFIXES = Object.freeze([
  'tooling/install/',
  'tooling/vscode/',
  'tooling/sublime/'
]);

export const TEST_SUITE_CATEGORIES = Object.freeze([
  'hero',
  'matrix',
  'meta',
  'soak',
  'heavy-runtime'
]);

const normalizeId = (id) => String(id || '').trim().replace(/\\/g, '/');

const testIdHasSegment = (id, segment) => id.split('/').includes(segment);

export const inferSuiteCategory = ({ id, lane = '', tags = [] } = {}) => {
  const normalizedId = normalizeId(id);
  const normalizedLane = String(lane || '').trim();
  const normalizedTags = Array.isArray(tags)
    ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  const baseName = normalizedId.split('/').pop() || '';

  if (!normalizedId) {
    return { category: 'hero', reason: 'default-empty-id' };
  }
  if (normalizedId.startsWith('services/soak/')) {
    return { category: 'soak', reason: 'services-soak-prefix' };
  }
  if (baseName.includes('matrix')) {
    return { category: 'matrix', reason: 'matrix-filename' };
  }
  if (META_IDS.has(normalizedId) || META_PREFIXES.some((prefix) => normalizedId.startsWith(prefix))) {
    return { category: 'meta', reason: 'meta-cohort-prefix' };
  }
  if (
    normalizedLane === 'ci-long'
    || normalizedTags.includes('long')
    || testIdHasSegment(normalizedId, 'heavy-runtime')
  ) {
    return { category: 'heavy-runtime', reason: 'long-lane-or-tag' };
  }
  if (HERO_PREFIXES.some((prefix) => normalizedId.startsWith(prefix))) {
    return { category: 'hero', reason: 'peripheral-tooling-surface' };
  }
  return { category: 'hero', reason: 'default-standalone-behavior' };
};

export const buildSuiteCategorySummary = (tests) => {
  const summary = Object.fromEntries(TEST_SUITE_CATEGORIES.map((category) => [category, 0]));
  for (const test of Array.isArray(tests) ? tests : []) {
    const category = String(test?.suiteCategory || '').trim();
    if (!summary[category] && summary[category] !== 0) continue;
    summary[category] += 1;
  }
  return summary;
};
