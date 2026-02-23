const EMPTY_ARRAY = [];

const DEFAULT_FIXTURE_REVIEWERS = ['usr-architecture', 'usr-conformance'];

const CONFIG_LANGUAGE_FIXTURE_SUFFIX_BY_ID = {
  ini: 'multi-section-001',
  json: 'nested-objects-001',
  toml: 'array-of-tables-001',
  xml: 'namespaces-and-includes-001',
  yaml: 'anchors-aliases-001'
};

const LANGUAGE_CONFORMANCE_FLAG_C2 = 1;
const LANGUAGE_CONFORMANCE_FLAG_C3 = 1 << 1;
const LANGUAGE_CONFORMANCE_FLAG_C4 = 1 << 2;

const LANGUAGE_FAMILIES_BY_MASK = [
  ['golden', 'language-baseline'],
  ['golden', 'language-baseline', 'semantic-flow'],
  ['golden', 'language-baseline', 'risk'],
  ['golden', 'language-baseline', 'risk', 'semantic-flow'],
  ['framework-overlay', 'golden', 'language-baseline'],
  ['framework-overlay', 'golden', 'language-baseline', 'semantic-flow'],
  ['framework-overlay', 'golden', 'language-baseline', 'risk'],
  ['framework-overlay', 'golden', 'language-baseline', 'risk', 'semantic-flow']
];

const LANGUAGE_FAMILIES_WITH_CONFIG_BY_MASK = [
  ['config', 'golden', 'language-baseline'],
  ['config', 'golden', 'language-baseline', 'semantic-flow'],
  ['config', 'golden', 'language-baseline', 'risk'],
  ['config', 'golden', 'language-baseline', 'risk', 'semantic-flow'],
  ['config', 'framework-overlay', 'golden', 'language-baseline'],
  ['config', 'framework-overlay', 'golden', 'language-baseline', 'semantic-flow'],
  ['config', 'framework-overlay', 'golden', 'language-baseline', 'risk'],
  ['config', 'framework-overlay', 'golden', 'language-baseline', 'risk', 'semantic-flow']
];

const FRAMEWORK_FAMILY_FLAG_TEMPLATE_BINDING = 1;
const FRAMEWORK_FAMILY_FLAG_STYLE_SCOPE = 1 << 1;
const FRAMEWORK_FAMILY_FLAG_ROUTE_SEMANTICS = 1 << 2;
const FRAMEWORK_FAMILY_FLAG_HYDRATION = 1 << 3;

const FRAMEWORK_FAMILIES_BY_MASK = Array.from({ length: 16 }, (_, mask) => {
  const families = ['framework-overlay'];
  if (mask & FRAMEWORK_FAMILY_FLAG_HYDRATION) families.push('hydration');
  if (mask & FRAMEWORK_FAMILY_FLAG_ROUTE_SEMANTICS) families.push('route-semantics');
  if (mask & FRAMEWORK_FAMILY_FLAG_STYLE_SCOPE) families.push('style-scope');
  if (mask & FRAMEWORK_FAMILY_FLAG_TEMPLATE_BINDING) families.push('template-binding');
  return families;
});

const ROADMAP_PHASE_FLAG_4 = 1;
const ROADMAP_PHASE_FLAG_5 = 1 << 1;
const ROADMAP_PHASE_FLAG_6 = 1 << 2;
const ROADMAP_PHASE_FLAG_7 = 1 << 3;
const ROADMAP_PHASE_FLAG_8 = 1 << 4;
const ROADMAP_PHASE_FLAG_9 = 1 << 5;
const ROADMAP_PHASE_FLAG_10 = 1 << 6;
const ROADMAP_PHASE_FLAG_14 = 1 << 7;

const ROADMAP_PHASE_TAGS_IN_LEXICAL_ORDER = [
  [ROADMAP_PHASE_FLAG_10, 'phase-10'],
  [ROADMAP_PHASE_FLAG_14, 'phase-14'],
  [ROADMAP_PHASE_FLAG_4, 'phase-4'],
  [ROADMAP_PHASE_FLAG_5, 'phase-5'],
  [ROADMAP_PHASE_FLAG_6, 'phase-6'],
  [ROADMAP_PHASE_FLAG_7, 'phase-7'],
  [ROADMAP_PHASE_FLAG_8, 'phase-8'],
  [ROADMAP_PHASE_FLAG_9, 'phase-9']
];

function compareByFixtureId(a, b) {
  return a.fixtureId.localeCompare(b.fixtureId);
}

/**
 * Convert language conformance levels to a compact bitmask key.
 *
 * This is hot-path logic during baseline generation. We only track C2-C4
 * because fixture-family expansion does not depend on C0/C1.
 *
 * @param {string[]} requiredConformance
 * @returns {number}
 */
function conformanceMask(requiredConformance) {
  let mask = 0;
  for (let i = 0; i < requiredConformance.length; i += 1) {
    const level = requiredConformance[i];
    if (level === 'C2') mask |= LANGUAGE_CONFORMANCE_FLAG_C2;
    else if (level === 'C3') mask |= LANGUAGE_CONFORMANCE_FLAG_C3;
    else if (level === 'C4') mask |= LANGUAGE_CONFORMANCE_FLAG_C4;
  }
  return mask;
}

/**
 * Collapse required edge kinds into one framework family mask.
 *
 * Both `template_binds` and `template_emits` map to the same output family so
 * this helper avoids duplicate work while keeping deterministic ordering.
 *
 * @param {string[]} requiredEdgeKinds
 * @returns {number}
 */
function frameworkFamilyMask(requiredEdgeKinds) {
  let mask = 0;
  for (let i = 0; i < requiredEdgeKinds.length; i += 1) {
    const edgeKind = requiredEdgeKinds[i];
    if (edgeKind === 'template_binds' || edgeKind === 'template_emits') {
      mask |= FRAMEWORK_FAMILY_FLAG_TEMPLATE_BINDING;
    } else if (edgeKind === 'style_scopes') {
      mask |= FRAMEWORK_FAMILY_FLAG_STYLE_SCOPE;
    } else if (edgeKind === 'route_maps_to') {
      mask |= FRAMEWORK_FAMILY_FLAG_ROUTE_SEMANTICS;
    } else if (edgeKind === 'hydration_boundary') {
      mask |= FRAMEWORK_FAMILY_FLAG_HYDRATION;
    }
  }
  return mask;
}

/**
 * Resolve roadmap phases for one fixture row.
 *
 * The returned mask intentionally keeps phase dedupe and ordering independent.
 * Ordering is applied later in lexical order to preserve existing generated
 * JSON without per-row `Set + sort` overhead.
 *
 * @param {{profileType:string,families?:string[]}} row
 * @returns {number}
 */
function roadmapPhaseMaskForFixture(row) {
  let mask = ROADMAP_PHASE_FLAG_7;

  if (row.profileType === 'language') {
    mask |= ROADMAP_PHASE_FLAG_4;
  } else if (row.profileType === 'framework') {
    mask |= ROADMAP_PHASE_FLAG_5;
  } else {
    mask |= ROADMAP_PHASE_FLAG_9;
  }

  const families = row.families || EMPTY_ARRAY;
  for (let i = 0; i < families.length; i += 1) {
    const family = families[i];
    if (
      family === 'failure-injection'
      || family === 'integration'
      || family === 'api-boundary'
      || family === 'data-boundary'
    ) {
      mask |= ROADMAP_PHASE_FLAG_14;
    } else if (family === 'framework-overlay') {
      mask |= ROADMAP_PHASE_FLAG_5;
    } else if (family === 'backcompat') {
      mask |= ROADMAP_PHASE_FLAG_10;
    } else if (family === 'risk' || family === 'semantic-flow') {
      mask |= ROADMAP_PHASE_FLAG_6;
    } else if (family === 'performance') {
      mask |= ROADMAP_PHASE_FLAG_8;
    }
  }

  return mask;
}

/**
 * Derive sorted roadmap tags for one fixture governance row.
 *
 * @param {{profileType:string,profileId:string,families?:string[]}} row
 * @returns {string[]}
 */
function roadmapTagsForFixture(row) {
  const tags = [];
  if (row.profileType === 'language') {
    tags.push(`appendix-c:${row.profileId}`);
  } else if (row.profileType === 'framework') {
    tags.push(`appendix-d:${row.profileId}`);
  }

  const phaseMask = roadmapPhaseMaskForFixture(row);
  for (let i = 0; i < ROADMAP_PHASE_TAGS_IN_LEXICAL_ORDER.length; i += 1) {
    const [flag, phaseTag] = ROADMAP_PHASE_TAGS_IN_LEXICAL_ORDER[i];
    if (phaseMask & flag) {
      tags.push(phaseTag);
    }
  }
  return tags;
}

/**
 * Build generated language fixture governance rows.
 *
 * @param {{
 *   id:string,
 *   requiredConformance:string[]
 * }[]} languageBaselines
 * @returns {object[]}
 */
function buildGeneratedLanguageFixtureGovernanceRows(languageBaselines) {
  const rows = new Array(languageBaselines.length * 2);
  let rowCount = 0;

  for (let i = 0; i < languageBaselines.length; i += 1) {
    const base = languageBaselines[i];
    const mask = conformanceMask(base.requiredConformance);
    const conformanceLevels = [...base.requiredConformance];
    const owner = `language-${base.id}`;

    rows[rowCount] = {
      fixtureId: `${base.id}::baseline::coverage-001`,
      profileType: 'language',
      profileId: base.id,
      conformanceLevels,
      families: [...LANGUAGE_FAMILIES_BY_MASK[mask]],
      owner,
      reviewers: [...DEFAULT_FIXTURE_REVIEWERS],
      stabilityClass: 'stable',
      mutationPolicy: 'require-review',
      goldenRequired: true,
      blocking: true
    };
    rowCount += 1;

    const configSuffix = CONFIG_LANGUAGE_FIXTURE_SUFFIX_BY_ID[base.id];
    if (configSuffix) {
      rows[rowCount] = {
        fixtureId: `${base.id}::config::${configSuffix}`,
        profileType: 'language',
        profileId: base.id,
        conformanceLevels,
        families: [...LANGUAGE_FAMILIES_WITH_CONFIG_BY_MASK[mask]],
        owner,
        reviewers: [...DEFAULT_FIXTURE_REVIEWERS],
        stabilityClass: 'stable',
        mutationPolicy: 'require-review',
        goldenRequired: true,
        blocking: true
      };
      rowCount += 1;
    }
  }

  return rows.slice(0, rowCount);
}

/**
 * Build generated framework fixture governance rows.
 *
 * @param {{
 *   id:string,
 *   requiredConformance?:string[],
 *   bindingSemantics?:{requiredEdgeKinds?:string[]}
 * }[]} frameworkProfiles
 * @returns {object[]}
 */
function buildGeneratedFrameworkFixtureGovernanceRows(frameworkProfiles) {
  const rows = new Array(frameworkProfiles.length);

  for (let i = 0; i < frameworkProfiles.length; i += 1) {
    const profile = frameworkProfiles[i];
    const requiredEdgeKinds = profile?.bindingSemantics?.requiredEdgeKinds || EMPTY_ARRAY;
    const familyMask = frameworkFamilyMask(requiredEdgeKinds);
    rows[i] = {
      fixtureId: `${profile.id}::framework-overlay::baseline-001`,
      profileType: 'framework',
      profileId: profile.id,
      conformanceLevels: [...(profile.requiredConformance || ['C4'])],
      families: [...FRAMEWORK_FAMILIES_BY_MASK[familyMask]],
      owner: `framework-${profile.id}`,
      reviewers: [...DEFAULT_FIXTURE_REVIEWERS],
      stabilityClass: 'stable',
      mutationPolicy: 'require-review',
      goldenRequired: true,
      blocking: true
    };
  }

  return rows;
}

/**
 * Build the full fixture governance dataset with roadmap tags.
 *
 * @param {{
 *   languageBaselines:{id:string,requiredConformance:string[]}[],
 *   frameworkProfiles:{id:string,requiredConformance?:string[],bindingSemantics?:{requiredEdgeKinds?:string[]}}[],
 *   supplementalRows?:object[]
 * }} input
 * @returns {object[]}
 */
function buildFixtureGovernance({ languageBaselines, frameworkProfiles, supplementalRows = EMPTY_ARRAY }) {
  const generatedLanguageRows = buildGeneratedLanguageFixtureGovernanceRows(languageBaselines);
  const generatedFrameworkRows = buildGeneratedFrameworkFixtureGovernanceRows(frameworkProfiles);
  const totalRows = generatedLanguageRows.length + generatedFrameworkRows.length + supplementalRows.length;
  const rows = new Array(totalRows);
  let index = 0;

  const generatedGroups = [generatedLanguageRows, generatedFrameworkRows, supplementalRows];
  for (let groupIndex = 0; groupIndex < generatedGroups.length; groupIndex += 1) {
    const group = generatedGroups[groupIndex];
    for (let rowIndex = 0; rowIndex < group.length; rowIndex += 1) {
      const row = group[rowIndex];
      rows[index] = {
        ...row,
        roadmapTags: roadmapTagsForFixture(row)
      };
      index += 1;
    }
  }

  rows.sort(compareByFixtureId);
  return rows;
}

export {
  roadmapTagsForFixture,
  buildFixtureGovernance
};
