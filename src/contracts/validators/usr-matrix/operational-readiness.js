const REQUIRED_OPERATIONAL_PHASES = Object.freeze(['pre-cutover', 'cutover', 'incident', 'post-cutover']);
const REQUIRED_BLOCKING_OPERATIONAL_PHASES = Object.freeze(['pre-cutover', 'cutover', 'incident']);
const REQUIRED_BLOCKING_QUALITY_DOMAINS = Object.freeze(['framework-binding', 'minimum-slice', 'provenance', 'resolution']);

const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const emptyOperationalResult = (errors) => ({
  ok: false,
  blocked: true,
  blockers: Object.freeze([]),
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([]),
  rows: Object.freeze([]),
  conformanceByLevel: Object.freeze({}),
  readiness: Object.freeze({
    testRolloutBlocked: true,
    deepConformanceBlocked: true,
    frameworkConformanceBlocked: true
  })
});

const resolveReportStatus = ({ errors = [], warnings = [], blocked = false }) => (
  blocked || errors.length > 0
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
 * Evaluates operational readiness policy + quality gates + conformance readiness.
 *
 * @param {object} [input]
 * @param {object} [input.operationalReadinessPolicyPayload]
 * @param {object} [input.qualityGatesPayload]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.conformanceLevelsPayload]
 * @param {string[]} [input.knownLanes]
 * @param {string[]} [input.missingArtifactSchemas]
 * @param {string[]} [input.failingBlockingGateIds]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(input:object)=>{ok:boolean,blocked:boolean,blockers:ReadonlyArray<string>,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,conformanceByLevel:Readonly<Record<string,object>>,readiness:Readonly<object>}} input.evaluateConformancePromotionReadiness
 * @returns {{ok:boolean,blocked:boolean,blockers:ReadonlyArray<string>,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>,conformanceByLevel:Readonly<Record<string,object>>,readiness:Readonly<object>}}
 */
export function evaluateUsrOperationalReadiness({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifactSchemas = [],
  failingBlockingGateIds = [],
  validateRegistry,
  evaluateConformancePromotionReadiness
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyOperationalResult(['validateRegistry callback is required']);
  }
  if (typeof evaluateConformancePromotionReadiness !== 'function') {
    return emptyOperationalResult(['evaluateConformancePromotionReadiness callback is required']);
  }

  const operationalValidation = validateRegistry('usr-operational-readiness-policy', operationalReadinessPolicyPayload);
  if (!operationalValidation?.ok) {
    return emptyOperationalResult(operationalValidation?.errors || ['invalid usr-operational-readiness-policy payload']);
  }

  const qualityValidation = validateRegistry('usr-quality-gates', qualityGatesPayload);
  if (!qualityValidation?.ok) {
    return emptyOperationalResult(qualityValidation?.errors || ['invalid usr-quality-gates payload']);
  }

  const errors = [];
  const warnings = [];
  const policyBlockers = [];
  const rows = [];

  const operationalRows = Array.isArray(operationalReadinessPolicyPayload?.rows) ? operationalReadinessPolicyPayload.rows : [];
  const qualityRows = Array.isArray(qualityGatesPayload?.rows) ? qualityGatesPayload.rows : [];

  const phasesPresent = new Set(operationalRows.map((row) => row.phase));
  for (const phase of REQUIRED_OPERATIONAL_PHASES) {
    if (!phasesPresent.has(phase)) {
      const message = `operational readiness policy missing required phase: ${phase}`;
      errors.push(message);
      policyBlockers.push(`operational-readiness-policy:${phase}:missing-phase`);
    }
  }

  for (const phase of REQUIRED_BLOCKING_OPERATIONAL_PHASES) {
    const phaseRows = operationalRows.filter((row) => row.phase === phase);
    if (phaseRows.length === 0) {
      const message = `operational readiness policy missing phase rows for ${phase}`;
      errors.push(message);
      policyBlockers.push(`operational-readiness-policy:${phase}:missing-phase-rows`);
      continue;
    }
    if (!phaseRows.some((row) => row.blocking === true)) {
      const message = `operational readiness policy phase ${phase} requires at least one blocking row`;
      errors.push(message);
      policyBlockers.push(`operational-readiness-policy:${phase}:missing-blocking-row`);
    }
  }

  const blockingQualityRows = qualityRows.filter((row) => row.blocking === true);
  if (blockingQualityRows.length === 0) {
    errors.push('quality gates policy must include blocking rows');
    policyBlockers.push('quality-gates-policy:missing-blocking-rows');
  }

  const blockingDomains = new Set(blockingQualityRows.map((row) => row.domain));
  for (const domain of REQUIRED_BLOCKING_QUALITY_DOMAINS) {
    if (!blockingDomains.has(domain)) {
      const message = `quality gates policy missing blocking domain: ${domain}`;
      errors.push(message);
      policyBlockers.push(`quality-gates-policy:${domain}:missing-blocking-domain`);
    }
  }

  const blockingQualityGateIds = new Set(blockingQualityRows.map((row) => row.id));
  const normalizedFailingGateIds = [];
  for (const gateId of asStringArray(failingBlockingGateIds)) {
    if (blockingQualityGateIds.has(gateId)) {
      normalizedFailingGateIds.push(gateId);
    } else {
      warnings.push(`failing gate id does not map to blocking quality gate: ${gateId}`);
    }
  }

  const promotionReadiness = evaluateConformancePromotionReadiness({
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifacts: missingArtifactSchemas,
    failingBlockingGateIds: normalizedFailingGateIds
  });

  for (const row of operationalRows) {
    rows.push({
      rowType: 'operational-phase',
      id: row.id,
      phase: row.phase,
      blocking: Boolean(row.blocking),
      pass: true,
      errors: Object.freeze([]),
      warnings: Object.freeze([])
    });
  }

  for (const row of qualityRows) {
    rows.push({
      rowType: 'quality-gate',
      id: row.id,
      domain: row.domain,
      blocking: Boolean(row.blocking),
      pass: true,
      errors: Object.freeze([]),
      warnings: Object.freeze([])
    });
  }

  const blockers = [...new Set([...policyBlockers, ...promotionReadiness.blockers])];
  const allErrors = [...errors, ...promotionReadiness.errors];
  const allWarnings = [...warnings, ...promotionReadiness.warnings];

  return {
    ok: blockers.length === 0 && allErrors.length === 0,
    blocked: blockers.length > 0 || allErrors.length > 0,
    blockers: Object.freeze(blockers),
    errors: Object.freeze(allErrors),
    warnings: Object.freeze(allWarnings),
    rows: Object.freeze(rows),
    conformanceByLevel: promotionReadiness.conformanceByLevel,
    readiness: promotionReadiness.readiness
  };
}

/**
 * Builds operational readiness validation report payload.
 *
 * @param {object} [input]
 * @returns {{ok:boolean,blocked:boolean,blockers:ReadonlyArray<string>,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>,payload:object}}
 */
export function buildUsrOperationalReadinessValidationReport({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifactSchemas = [],
  failingBlockingGateIds = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-operational-readiness-validator',
  producerVersion = null,
  runId = 'run-usr-operational-readiness-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' },
  validateRegistry,
  evaluateConformancePromotionReadiness,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const evaluation = evaluateUsrOperationalReadiness({
    operationalReadinessPolicyPayload,
    qualityGatesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifactSchemas,
    failingBlockingGateIds,
    validateRegistry,
    evaluateConformancePromotionReadiness
  });

  const rows = evaluation.rows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  }));
  let operationalPhaseRowCount = 0;
  let qualityGateRowCount = 0;
  for (const row of rows) {
    if (row.rowType === 'operational-phase') {
      operationalPhaseRowCount += 1;
    } else if (row.rowType === 'quality-gate') {
      qualityGateRowCount += 1;
    }
  }

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-operational-readiness-validation',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(evaluation),
    scope: normalizeScope(scope, 'lane', lane),
    summary: {
      blocked: evaluation.blocked,
      blockerCount: evaluation.blockers.length,
      errorCount: evaluation.errors.length,
      warningCount: evaluation.warnings.length,
      rowCount: rows.length,
      operationalPhaseRowCount,
      qualityGateRowCount,
      readiness: evaluation.readiness,
      conformanceByLevel: evaluation.conformanceByLevel
    },
    blockingFindings: [
      ...evaluation.blockers.map((message) => ({ class: 'operational-readiness', message })),
      ...evaluation.errors.map((message) => ({ class: 'operational-readiness', message }))
    ],
    advisoryFindings: evaluation.warnings.map((message) => ({ class: 'operational-readiness', message })),
    rows
  };

  return {
    ok: evaluation.ok,
    blocked: evaluation.blocked,
    blockers: evaluation.blockers,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
}
