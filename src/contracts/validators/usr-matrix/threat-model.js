const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

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
 * Validate threat-model rows against fixture/security/alert/redaction controls.
 *
 * @param {object} [input]
 * @param {object} [input.threatModelPayload]
 * @param {object} [input.fixtureGovernancePayload]
 * @param {object} [input.securityGatesPayload]
 * @param {object} [input.alertPoliciesPayload]
 * @param {object} [input.redactionRulesPayload]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrThreatModelCoverage({
  threatModelPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const threatValidation = validateRegistry('usr-threat-model-matrix', threatModelPayload);
  if (!threatValidation?.ok) {
    return emptyValidationResult(threatValidation?.errors || ['invalid usr-threat-model-matrix payload']);
  }

  const fixtureValidation = validateRegistry('usr-fixture-governance', fixtureGovernancePayload);
  if (!fixtureValidation?.ok) {
    return emptyValidationResult(fixtureValidation?.errors || ['invalid usr-fixture-governance payload']);
  }

  const securityValidation = validateRegistry('usr-security-gates', securityGatesPayload);
  if (!securityValidation?.ok) {
    return emptyValidationResult(securityValidation?.errors || ['invalid usr-security-gates payload']);
  }

  const alertValidation = validateRegistry('usr-alert-policies', alertPoliciesPayload);
  if (!alertValidation?.ok) {
    return emptyValidationResult(alertValidation?.errors || ['invalid usr-alert-policies payload']);
  }

  const redactionValidation = validateRegistry('usr-redaction-rules', redactionRulesPayload);
  if (!redactionValidation?.ok) {
    return emptyValidationResult(redactionValidation?.errors || ['invalid usr-redaction-rules payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const threatRows = Array.isArray(threatModelPayload?.rows) ? threatModelPayload.rows : [];
  const fixtureRows = Array.isArray(fixtureGovernancePayload?.rows) ? fixtureGovernancePayload.rows : [];
  const securityRows = Array.isArray(securityGatesPayload?.rows) ? securityGatesPayload.rows : [];
  const alertRows = Array.isArray(alertPoliciesPayload?.rows) ? alertPoliciesPayload.rows : [];
  const redactionRows = Array.isArray(redactionRulesPayload?.rows) ? redactionRulesPayload.rows : [];

  const controlIds = new Set([
    ...securityRows.map((row) => row.id),
    ...alertRows.map((row) => row.id),
    ...redactionRows.map((row) => row.id)
  ]);

  const fixtureById = new Map(fixtureRows.map((row) => [row.fixtureId, row]));
  const threatIdCounts = new Map();
  for (const row of threatRows) {
    threatIdCounts.set(row.id, (threatIdCounts.get(row.id) || 0) + 1);
  }

  for (const row of threatRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((threatIdCounts.get(row.id) || 0) > 1) {
      rowErrors.push('threat id must be unique within threat-model matrix');
    }

    const requiredControls = asStringArray(row.requiredControls);
    const requiredFixtures = asStringArray(row.requiredFixtures);

    if (requiredControls.length === 0) {
      rowErrors.push('requiredControls must contain at least one control id');
    }
    if (requiredFixtures.length === 0) {
      rowErrors.push('requiredFixtures must contain at least one fixture id');
    }

    const missingControls = requiredControls.filter((controlId) => !controlIds.has(controlId));
    const missingFixtures = requiredFixtures.filter((fixtureId) => !fixtureById.has(fixtureId));

    if (missingControls.length > 0) {
      rowErrors.push(`missing control mappings: ${missingControls.join(', ')}`);
    }
    if (missingFixtures.length > 0) {
      rowErrors.push(`missing fixture mappings: ${missingFixtures.join(', ')}`);
    }

    if (row.severity === 'critical' && row.blocking !== true) {
      rowErrors.push('critical threat rows must be blocking');
    }

    for (const fixtureId of requiredFixtures) {
      const fixtureRow = fixtureById.get(fixtureId);
      if (!fixtureRow) {
        continue;
      }
      if (row.blocking && fixtureRow.blocking !== true) {
        rowErrors.push(`blocking threat row requires blocking fixture mapping: ${fixtureId}`);
      }
      if (!Array.isArray(fixtureRow.families) || fixtureRow.families.length === 0) {
        rowWarnings.push(`mapped fixture has no family metadata: ${fixtureId}`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      threatClass: row.threatClass,
      attackSurface: row.attackSurface,
      severity: row.severity,
      blocking: Boolean(row.blocking),
      missingControls,
      missingFixtures,
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

export function buildUsrThreatModelCoverageReport({
  threatModelPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-threat-model-validator',
  producerVersion = null,
  runId = 'run-usr-threat-model-coverage',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const validation = validateUsrThreatModelCoverage({
    threatModelPayload,
    fixtureGovernancePayload,
    securityGatesPayload,
    alertPoliciesPayload,
    redactionRulesPayload,
    validateRegistry
  });

  const rows = validation.rows.map((row) => ({
    id: row.id,
    threatClass: row.threatClass,
    attackSurface: row.attackSurface,
    severity: row.severity,
    blocking: row.blocking,
    pass: row.pass,
    missingControls: row.missingControls,
    missingFixtures: row.missingFixtures,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-threat-model-coverage-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(validation),
    scope: normalizeScope(scope, 'global', 'global'),
    summary: {
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length,
      controlGapCount: rows.reduce((sum, row) => sum + row.missingControls.length, 0),
      fixtureGapCount: rows.reduce((sum, row) => sum + row.missingFixtures.length, 0)
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'threat-model',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'threat-model',
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
