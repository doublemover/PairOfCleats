const normalizeFailureScenarioResults = (results) => {
  if (Array.isArray(results)) {
    return new Map(
      results
        .filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
        .map((row) => [row.id, row])
    );
  }

  if (results && typeof results === 'object') {
    return new Map(Object.entries(results));
  }

  return new Map();
};

const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const validateScenarioCodeArrays = ({
  scenarioId,
  mode,
  diagnostics,
  reasonCodes,
  strictEnum,
  errors,
  validateDiagnosticCode,
  validateReasonCode
}) => {
  for (const diagnostic of diagnostics) {
    const diagnosticValidation = validateDiagnosticCode(diagnostic, { strictEnum });
    if (!diagnosticValidation.ok) {
      errors.push(`${scenarioId} ${mode} diagnostic invalid: ${diagnosticValidation.errors.join('; ')}`);
    }
  }

  for (const reasonCode of reasonCodes) {
    const reasonValidation = validateReasonCode(reasonCode, { strictEnum });
    if (!reasonValidation.ok) {
      errors.push(`${scenarioId} ${mode} reasonCode invalid: ${reasonValidation.errors.join('; ')}`);
    }
  }
};

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
 * Evaluate strict and non-strict failure-injection scenario outcomes.
 *
 * @param {object} [input]
 * @param {object} [input.matrixPayload]
 * @param {object|Array<object>} [input.strictScenarioResults]
 * @param {object|Array<object>} [input.nonStrictScenarioResults]
 * @param {boolean} [input.strictEnum]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(code:string,input?:object)=>{ok:boolean,errors?:string[]}} input.validateDiagnosticCode
 * @param {(code:string,input?:object)=>{ok:boolean,errors?:string[]}} input.validateReasonCode
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function evaluateUsrFailureInjectionScenarios({
  matrixPayload,
  strictScenarioResults = {},
  nonStrictScenarioResults = {},
  strictEnum = true,
  validateRegistry,
  validateDiagnosticCode,
  validateReasonCode
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }
  if (typeof validateDiagnosticCode !== 'function') {
    return emptyValidationResult(['validateDiagnosticCode callback is required']);
  }
  if (typeof validateReasonCode !== 'function') {
    return emptyValidationResult(['validateReasonCode callback is required']);
  }

  const matrixValidation = validateRegistry('usr-failure-injection-matrix', matrixPayload);
  if (!matrixValidation?.ok) {
    return emptyValidationResult(matrixValidation?.errors || ['invalid usr-failure-injection-matrix payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const matrixRows = Array.isArray(matrixPayload?.rows) ? matrixPayload.rows : [];
  const matrixIds = new Set(matrixRows.map((row) => row.id));

  const strictById = normalizeFailureScenarioResults(strictScenarioResults);
  const nonStrictById = normalizeFailureScenarioResults(nonStrictScenarioResults);

  for (const [id] of strictById.entries()) {
    if (!matrixIds.has(id)) {
      warnings.push(`strict scenario result does not map to matrix row: ${id}`);
    }
  }
  for (const [id] of nonStrictById.entries()) {
    if (!matrixIds.has(id)) {
      warnings.push(`non-strict scenario result does not map to matrix row: ${id}`);
    }
  }

  for (const row of matrixRows) {
    const rowErrors = [];

    const strictObserved = strictById.get(row.id) || null;
    const nonStrictObserved = nonStrictById.get(row.id) || null;

    if (!strictObserved) {
      rowErrors.push('missing strict scenario result');
    }
    if (!nonStrictObserved) {
      rowErrors.push('missing non-strict scenario result');
    }

    if (strictObserved && strictObserved.outcome !== row.strictExpectedOutcome) {
      rowErrors.push(`strict outcome mismatch: expected ${row.strictExpectedOutcome}, received ${strictObserved.outcome}`);
    }

    if (nonStrictObserved && nonStrictObserved.outcome !== row.nonStrictExpectedOutcome) {
      rowErrors.push(`non-strict outcome mismatch: expected ${row.nonStrictExpectedOutcome}, received ${nonStrictObserved.outcome}`);
    }

    const requiredDiagnostics = asStringArray(row.requiredDiagnostics);
    const requiredReasonCodes = asStringArray(row.requiredReasonCodes);
    const requiredRecoveryArtifacts = asStringArray(row.requiredRecoveryArtifacts);

    const strictDiagnostics = asStringArray(strictObserved?.diagnostics);
    const strictReasonCodes = asStringArray(strictObserved?.reasonCodes);
    const strictRecoveryEvidence = asStringArray(strictObserved?.recoveryEvidence);
    const nonStrictDiagnostics = asStringArray(nonStrictObserved?.diagnostics);
    const nonStrictReasonCodes = asStringArray(nonStrictObserved?.reasonCodes);
    const nonStrictRecoveryEvidence = asStringArray(nonStrictObserved?.recoveryEvidence);

    for (const requiredDiagnostic of requiredDiagnostics) {
      if (!strictDiagnostics.includes(requiredDiagnostic)) {
        rowErrors.push(`strict diagnostics missing required code ${requiredDiagnostic}`);
      }
      if (!nonStrictDiagnostics.includes(requiredDiagnostic)) {
        rowErrors.push(`non-strict diagnostics missing required code ${requiredDiagnostic}`);
      }
    }

    for (const requiredReasonCode of requiredReasonCodes) {
      if (!strictReasonCodes.includes(requiredReasonCode)) {
        rowErrors.push(`strict reasonCodes missing required code ${requiredReasonCode}`);
      }
      if (!nonStrictReasonCodes.includes(requiredReasonCode)) {
        rowErrors.push(`non-strict reasonCodes missing required code ${requiredReasonCode}`);
      }
    }

    if (row.blocking) {
      if (strictRecoveryEvidence.length === 0) {
        rowErrors.push('strict recoveryEvidence missing for blocking scenario');
      }
      if (nonStrictRecoveryEvidence.length === 0) {
        rowErrors.push('non-strict recoveryEvidence missing for blocking scenario');
      }

      for (const requiredArtifact of requiredRecoveryArtifacts) {
        if (!strictRecoveryEvidence.includes(requiredArtifact)) {
          rowErrors.push(`strict recoveryEvidence missing required artifact ${requiredArtifact}`);
        }
        if (!nonStrictRecoveryEvidence.includes(requiredArtifact)) {
          rowErrors.push(`non-strict recoveryEvidence missing required artifact ${requiredArtifact}`);
        }
      }
    }

    validateScenarioCodeArrays({
      scenarioId: row.id,
      mode: 'strict',
      diagnostics: strictDiagnostics,
      reasonCodes: strictReasonCodes,
      strictEnum,
      errors: rowErrors,
      validateDiagnosticCode,
      validateReasonCode
    });

    validateScenarioCodeArrays({
      scenarioId: row.id,
      mode: 'non-strict',
      diagnostics: nonStrictDiagnostics,
      reasonCodes: nonStrictReasonCodes,
      strictEnum,
      errors: rowErrors,
      validateDiagnosticCode,
      validateReasonCode
    });

    const pass = rowErrors.length === 0;
    if (!pass) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      faultClass: row.faultClass,
      injectionLayer: row.injectionLayer,
      blocking: Boolean(row.blocking),
      strictExpectedOutcome: row.strictExpectedOutcome,
      nonStrictExpectedOutcome: row.nonStrictExpectedOutcome,
      strictObservedOutcome: strictObserved?.outcome ?? null,
      nonStrictObservedOutcome: nonStrictObserved?.outcome ?? null,
      strictRecoveryEvidenceCount: strictRecoveryEvidence.length,
      nonStrictRecoveryEvidenceCount: nonStrictRecoveryEvidence.length,
      pass,
      errors: Object.freeze([...rowErrors])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrFailureInjectionReport({
  matrixPayload,
  strictScenarioResults = {},
  nonStrictScenarioResults = {},
  strictMode = true,
  strictEnum = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-failure-injection-evaluator',
  producerVersion = null,
  runId = 'run-usr-failure-injection-report',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  validateDiagnosticCode,
  validateReasonCode,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const evaluation = evaluateUsrFailureInjectionScenarios({
    matrixPayload,
    strictScenarioResults,
    nonStrictScenarioResults,
    strictEnum,
    validateRegistry,
    validateDiagnosticCode,
    validateReasonCode
  });

  const rows = evaluation.rows.map((row) => ({
    id: row.id,
    faultClass: row.faultClass,
    injectionLayer: row.injectionLayer,
    blocking: row.blocking,
    strictExpectedOutcome: row.strictExpectedOutcome,
    nonStrictExpectedOutcome: row.nonStrictExpectedOutcome,
    strictObservedOutcome: row.strictObservedOutcome,
    nonStrictObservedOutcome: row.nonStrictObservedOutcome,
    strictRecoveryEvidenceCount: row.strictRecoveryEvidenceCount,
    nonStrictRecoveryEvidenceCount: row.nonStrictRecoveryEvidenceCount,
    pass: row.pass,
    errors: row.errors
  }));

  const failRows = rows.filter((row) => row.pass === false);
  const blockingFailureCount = failRows.filter((row) => row.blocking).length;

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-failure-injection-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(evaluation),
    scope: normalizeScope(scope, 'global', 'global'),
    summary: {
      strictMode,
      scenarioCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: failRows.length,
      blockingFailureCount,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'failure-injection',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'failure-injection',
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
