export const CONFORMANCE_DASHBOARD_LEVELS = Object.freeze(['C0', 'C1', 'C2', 'C3', 'C4']);

/**
 * Builds per-level conformance evaluation map used by language/framework
 * dashboard report builders.
 *
 * @param {object} [input]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.conformanceLevelsPayload]
 * @param {string[]} [input.knownLanes]
 * @param {string[]} [input.levels]
 * @param {(input:object)=>{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}} input.validateConformanceLevelCoverage
 * @returns {{coverageByLevel:Map<string,{evaluation:object,rowsByProfileId:Map<string,object>}>,errors:string[],warnings:string[]}}
 */
export const buildConformanceCoverageMapByLevel = ({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  levels = CONFORMANCE_DASHBOARD_LEVELS,
  validateConformanceLevelCoverage
} = {}) => {
  const coverageByLevel = new Map();
  const errors = [];
  const warnings = [];

  for (const level of levels) {
    const evaluation = validateConformanceLevelCoverage({
      targetLevel: level,
      languageProfilesPayload,
      conformanceLevelsPayload,
      knownLanes
    });

    coverageByLevel.set(level, {
      evaluation,
      rowsByProfileId: new Map((evaluation.rows || []).map((row) => [row.profileId, row]))
    });

    if (evaluation.errors.length > 0) {
      errors.push(...evaluation.errors.map((message) => `${level} ${message}`));
    }
    if (evaluation.warnings.length > 0) {
      warnings.push(...evaluation.warnings.map((message) => `${level} ${message}`));
    }
  }

  return {
    coverageByLevel,
    errors,
    warnings
  };
};
