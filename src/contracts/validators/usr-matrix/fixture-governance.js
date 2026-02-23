const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const OWNER_PREFIX_BY_PROFILE_TYPE = Object.freeze({
  language: 'language-',
  framework: 'framework-',
  'cross-cutting': 'usr-'
});

const emptyValidationResult = (errors) => ({
  ok: false,
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([]),
  rows: Object.freeze([])
});

const resolveReportStatus = ({ errors = [], warnings = [] }) => (
  errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass')
);

const normalizeScopeWithFallback = (
  scope,
  fallbackScopeType = 'global',
  fallbackScopeId = 'global'
) => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : fallbackScopeType,
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : fallbackScopeId
    }
    : { scopeType: fallbackScopeType, scopeId: fallbackScopeId }
);

/**
 * Validates fixture-governance matrix rows for ownership, conformance,
 * roadmap linkage, and blocking-policy constraints.
 *
 * @param {object} [input]
 * @param {object} [input.fixtureGovernancePayload]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const matrixValidation = validateRegistry('usr-fixture-governance', fixtureGovernancePayload);
  if (!matrixValidation?.ok) {
    return emptyValidationResult(matrixValidation?.errors || ['invalid usr-fixture-governance payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const payloadRows = Array.isArray(fixtureGovernancePayload?.rows) ? fixtureGovernancePayload.rows : [];
  const fixtureIdCounts = new Map();
  for (const row of payloadRows) {
    fixtureIdCounts.set(row.fixtureId, (fixtureIdCounts.get(row.fixtureId) || 0) + 1);
  }

  for (const row of payloadRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((fixtureIdCounts.get(row.fixtureId) || 0) > 1) {
      rowErrors.push('fixtureId must be unique within fixture-governance matrix');
    }

    if (typeof row.owner !== 'string' || row.owner.trim() === '') {
      rowErrors.push('owner must be non-empty');
    }

    const reviewers = asStringArray(row.reviewers);
    if (reviewers.length === 0) {
      rowErrors.push('reviewers must contain at least one reviewer');
    }

    if (reviewers.includes(row.owner)) {
      rowWarnings.push('owner also appears in reviewers list');
    }

    let distinctReviewerCountWithoutOwner = 0;
    let hasArchitectureOrConformanceCoverage = false;
    for (const reviewer of reviewers) {
      if (reviewer !== row.owner) {
        distinctReviewerCountWithoutOwner += 1;
      }
      if (reviewer === 'usr-architecture' || reviewer === 'usr-conformance') {
        hasArchitectureOrConformanceCoverage = true;
      }
    }

    if (row.blocking === true && distinctReviewerCountWithoutOwner === 0) {
      rowErrors.push('blocking fixture rows must include at least one reviewer distinct from owner');
    }

    if (row.blocking === true) {
      const expectedPrefix = OWNER_PREFIX_BY_PROFILE_TYPE[row.profileType];
      if (expectedPrefix && !String(row.owner || '').startsWith(expectedPrefix)) {
        rowErrors.push(`blocking fixture row owner must use prefix ${expectedPrefix}`);
      }
      if (!hasArchitectureOrConformanceCoverage) {
        rowErrors.push('blocking fixture rows must include usr-architecture or usr-conformance reviewer coverage');
      }
    }

    const families = asStringArray(row.families);
    if (families.length === 0) {
      rowErrors.push('families must include at least one fixture family');
    }

    const roadmapTags = asStringArray(row.roadmapTags);
    if (roadmapTags.length === 0) {
      rowErrors.push('roadmapTags must include at least one roadmap linkage tag');
    }

    if (row.profileType === 'language' && !roadmapTags.includes(`appendix-c:${row.profileId}`)) {
      rowErrors.push(`language fixture rows must include appendix-c linkage tag for profile: appendix-c:${row.profileId}`);
    }

    if (row.profileType === 'framework' && !roadmapTags.includes(`appendix-d:${row.profileId}`)) {
      rowErrors.push(`framework fixture rows must include appendix-d linkage tag for profile: appendix-d:${row.profileId}`);
    }

    const conformanceLevels = asStringArray(row.conformanceLevels);
    if (conformanceLevels.length === 0) {
      rowErrors.push('conformanceLevels must include at least one level');
    }

    if (row.profileType === 'framework' && !conformanceLevels.includes('C4')) {
      rowErrors.push('framework fixture rows must include C4 in conformanceLevels');
    }

    if (families.includes('framework-overlay') && !conformanceLevels.includes('C4')) {
      rowErrors.push('framework-overlay families must include C4 conformance level');
    }

    if (families.includes('golden') && row.goldenRequired !== true) {
      rowErrors.push('golden family rows must set goldenRequired=true');
    }

    if (row.blocking === true && row.mutationPolicy === 'allow-generated-refresh') {
      rowErrors.push('blocking fixture rows cannot use mutationPolicy=allow-generated-refresh');
    }

    if (row.blocking === true && row.stabilityClass === 'volatile') {
      rowWarnings.push('blocking fixture row marked volatile; ensure drift is intentionally managed');
    }

    if (!/^language-|^framework-|^usr-/.test(String(row.owner || ''))) {
      rowWarnings.push('owner naming does not match expected prefix convention (language-/framework-/usr-)');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.fixtureId} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.fixtureId} ${message}`));
    }

    rows.push({
      fixtureId: row.fixtureId,
      profileType: row.profileType,
      profileId: row.profileId,
      blocking: Boolean(row.blocking),
      mutationPolicy: row.mutationPolicy,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

/**
 * Builds fixture-governance validation report payload from policy validation.
 *
 * @param {object} [input]
 * @param {object} [input.fixtureGovernancePayload]
 * @param {string} [input.generatedAt]
 * @param {string} [input.producerId]
 * @param {string|null} [input.producerVersion]
 * @param {string} [input.runId]
 * @param {string} [input.lane]
 * @param {string|null} [input.buildId]
 * @param {{scopeType?:string,scopeId?:string}} [input.scope]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(scope:unknown,fallbackScopeType?:string,fallbackScopeId?:string)=>{scopeType:string,scopeId:string}} [input.normalizeScope]
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>,payload:object}}
 */
export function buildUsrFixtureGovernanceValidationReport({
  fixtureGovernancePayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-fixture-governance-validator',
  producerVersion = null,
  runId = 'run-usr-fixture-governance-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const validation = validateUsrFixtureGovernanceControls({
    fixtureGovernancePayload,
    validateRegistry
  });
  const rows = validation.rows.map((row) => ({
    fixtureId: row.fixtureId,
    profileType: row.profileType,
    profileId: row.profileId,
    blocking: row.blocking,
    mutationPolicy: row.mutationPolicy,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  let passCount = 0;
  for (const row of rows) {
    if (row.pass) {
      passCount += 1;
    }
  }

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-validation-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(validation),
    scope: normalizeScope(scope, 'global', 'global'),
    summary: {
      validationDomain: 'fixture-governance',
      rowCount: rows.length,
      passCount,
      failCount: rows.length - passCount,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'fixture-governance',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'fixture-governance',
      message
    })),
    rows
  };

  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    rows,
    payload
  };
}
