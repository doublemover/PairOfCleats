const TEST_ROLLOUT_LEVELS = Object.freeze(['C0', 'C1']);
const DEEP_CONFORMANCE_LEVELS = Object.freeze(['C2', 'C3']);
const FRAMEWORK_CONFORMANCE_LEVELS = Object.freeze(['C4']);
const PROMOTION_READINESS_LEVELS = Object.freeze([
  ...TEST_ROLLOUT_LEVELS,
  ...DEEP_CONFORMANCE_LEVELS,
  ...FRAMEWORK_CONFORMANCE_LEVELS
]);

const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const toConformanceSummaryByLevel = (levelResults) => Object.freeze(
  Object.fromEntries(
    levelResults.map((row) => [
      row.level,
      Object.freeze({
        level: row.level,
        requiredProfileCount: row.requiredProfileCount,
        failingRequiredProfileCount: row.failingRequiredProfileCount,
        errorCount: row.errorCount,
        warningCount: row.warningCount,
        pass: row.pass
      })
    ])
  )
);

/**
 * Evaluates promotion readiness from conformance coverage plus external blockers.
 *
 * @param {object} [input]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.conformanceLevelsPayload]
 * @param {string[]} [input.knownLanes]
 * @param {string[]} [input.missingArtifacts]
 * @param {string[]} [input.failingBlockingGateIds]
 * @param {(input:object)=>{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}} input.validateConformanceLevelCoverage
 * @returns {{ok:boolean,blocked:boolean,blockers:ReadonlyArray<string>,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,conformanceByLevel:Readonly<Record<string,object>>,readiness:Readonly<{testRolloutBlocked:boolean,deepConformanceBlocked:boolean,frameworkConformanceBlocked:boolean}>}}
 */
export function evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifacts = [],
  failingBlockingGateIds = [],
  validateConformanceLevelCoverage
} = {}) {
  if (typeof validateConformanceLevelCoverage !== 'function') {
    return {
      ok: false,
      blocked: true,
      blockers: Object.freeze([]),
      errors: Object.freeze(['validateConformanceLevelCoverage callback is required']),
      warnings: Object.freeze([]),
      conformanceByLevel: Object.freeze({}),
      readiness: Object.freeze({
        testRolloutBlocked: true,
        deepConformanceBlocked: true,
        frameworkConformanceBlocked: true
      })
    };
  }

  const errors = [];
  const warnings = [];
  const blockers = [];
  const levelResults = [];

  for (const level of PROMOTION_READINESS_LEVELS) {
    const coverage = validateConformanceLevelCoverage({
      targetLevel: level,
      languageProfilesPayload,
      conformanceLevelsPayload,
      knownLanes
    });

    const requiredRows = coverage.rows.filter((row) => row.requiresLevel);
    const failingRequiredRows = requiredRows.filter((row) => !row.pass);

    const levelPass = coverage.errors.length === 0 && failingRequiredRows.length === 0 && requiredRows.length > 0;
    levelResults.push({
      level,
      requiredProfileCount: requiredRows.length,
      failingRequiredProfileCount: failingRequiredRows.length,
      errorCount: coverage.errors.length,
      warningCount: coverage.warnings.length,
      pass: levelPass
    });

    if (coverage.errors.length > 0) {
      errors.push(...coverage.errors.map((message) => `${level} ${message}`));
    }
    if (coverage.warnings.length > 0) {
      warnings.push(...coverage.warnings.map((message) => `${level} ${message}`));
    }

    if (!levelPass) {
      const missingRows = requiredRows.length === 0;
      const levelReason = missingRows
        ? 'no required profiles'
        : (coverage.errors[0] || `${failingRequiredRows.length} required profiles failing`);

      if (TEST_ROLLOUT_LEVELS.includes(level)) {
        blockers.push(`missing-test-rollout-readiness:${level}:${levelReason}`);
      }
      if (DEEP_CONFORMANCE_LEVELS.includes(level)) {
        blockers.push(`missing-deep-conformance-readiness:${level}:${levelReason}`);
      }
      if (FRAMEWORK_CONFORMANCE_LEVELS.includes(level)) {
        blockers.push(`missing-framework-conformance-readiness:${level}:${levelReason}`);
      }
    }
  }

  for (const artifactId of asStringArray(missingArtifacts)) {
    blockers.push(`missing-artifact:${artifactId}`);
  }
  for (const gateId of asStringArray(failingBlockingGateIds)) {
    blockers.push(`failing-gate:${gateId}`);
  }

  const uniqueBlockers = [...new Set(blockers)];
  const testRolloutBlocked = uniqueBlockers.some((blocker) => blocker.startsWith('missing-test-rollout-readiness:'));
  const deepConformanceBlocked = uniqueBlockers.some((blocker) => blocker.startsWith('missing-deep-conformance-readiness:'));
  const frameworkConformanceBlocked = uniqueBlockers.some((blocker) => blocker.startsWith('missing-framework-conformance-readiness:'));

  return {
    ok: uniqueBlockers.length === 0,
    blocked: uniqueBlockers.length > 0,
    blockers: Object.freeze(uniqueBlockers),
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    conformanceByLevel: toConformanceSummaryByLevel(levelResults),
    readiness: Object.freeze({
      testRolloutBlocked,
      deepConformanceBlocked,
      frameworkConformanceBlocked
    })
  };
}
