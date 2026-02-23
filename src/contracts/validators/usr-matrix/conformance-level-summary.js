const resolveReportStatus = ({ errors = [], warnings = [] }) => (
  errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass')
);

const normalizeScopeWithFallback = (
  scope,
  fallbackScopeType = 'lane',
  fallbackScopeId = 'ci'
) => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : fallbackScopeType,
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : fallbackScopeId
    }
    : { scopeType: fallbackScopeType, scopeId: fallbackScopeId }
);

/**
 * Builds conformance-level summary report from validated level coverage.
 *
 * @param {object} [input]
 * @param {string} [input.targetLevel]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.conformanceLevelsPayload]
 * @param {string[]} [input.knownLanes]
 * @param {string} [input.generatedAt]
 * @param {string} [input.producerId]
 * @param {string|null} [input.producerVersion]
 * @param {string} [input.runId]
 * @param {string|undefined} [input.lane]
 * @param {string|null} [input.buildId]
 * @param {{scopeType?:string,scopeId?:string}} [input.scope]
 * @param {(input:object)=>{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}} input.validateConformanceLevelCoverage
 * @param {(knownLanes:unknown)=>Record<string,string>} input.buildConformanceLaneByLevel
 * @param {(scope:unknown,fallbackScopeType?:string,fallbackScopeId?:string)=>{scopeType:string,scopeId:string}} [input.normalizeScope]
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>,payload:object}}
 */
export function buildUsrConformanceLevelSummaryReport({
  targetLevel,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-conformance-level-validator',
  producerVersion = null,
  runId = 'run-usr-conformance-level-summary',
  lane,
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'global' },
  validateConformanceLevelCoverage,
  buildConformanceLaneByLevel,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  if (typeof validateConformanceLevelCoverage !== 'function') {
    return {
      ok: false,
      errors: Object.freeze(['validateConformanceLevelCoverage callback is required']),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      payload: null
    };
  }
  if (typeof buildConformanceLaneByLevel !== 'function') {
    return {
      ok: false,
      errors: Object.freeze(['buildConformanceLaneByLevel callback is required']),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      payload: null
    };
  }

  const level = typeof targetLevel === 'string' ? targetLevel : '';
  const conformanceLaneByLevel = buildConformanceLaneByLevel(knownLanes);
  const defaultLane = conformanceLaneByLevel[level] || 'ci';
  const evaluation = validateConformanceLevelCoverage({
    targetLevel: level,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes
  });

  const rows = evaluation.rows.map((row) => ({
    profileId: row.profileId,
    targetLevel: row.targetLevel,
    requiresLevel: row.requiresLevel,
    hasConformanceRow: row.hasConformanceRow,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-conformance-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane: typeof lane === 'string' && lane.trim() ? lane : defaultLane,
    buildId,
    status: resolveReportStatus(evaluation),
    scope: normalizeScope(scope, 'lane', defaultLane),
    summary: {
      targetLevel: level,
      profileCount: rows.length,
      requiredProfileCount: rows.filter((row) => row.requiresLevel).length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'conformance',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'conformance',
      message
    })),
    rows
  };

  return {
    ok: evaluation.ok,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
}
