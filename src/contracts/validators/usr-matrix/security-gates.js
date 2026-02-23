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

const normalizeObservedResultMap = (observedResults, keyField = 'id') => {
  if (observedResults instanceof Map) {
    return new Map(observedResults.entries());
  }

  if (Array.isArray(observedResults)) {
    return new Map(
      observedResults
        .filter((row) => row && typeof row === 'object' && typeof row[keyField] === 'string')
        .map((row) => [row[keyField], row])
    );
  }

  if (observedResults && typeof observedResults === 'object') {
    return new Map(Object.entries(observedResults));
  }

  return new Map();
};

const resolveObservedGatePass = (observed) => {
  if (typeof observed === 'boolean') {
    return observed;
  }

  if (observed && typeof observed === 'object') {
    if (typeof observed.pass === 'boolean') {
      return observed.pass;
    }
    if (typeof observed.status === 'string') {
      return observed.status.toLowerCase() === 'pass';
    }
  }

  return null;
};

const resolveObservedRedactionResult = (observed) => {
  if (typeof observed === 'boolean') {
    return {
      pass: observed,
      misses: observed ? 0 : null
    };
  }

  if (observed && typeof observed === 'object') {
    if (typeof observed.pass === 'boolean') {
      return {
        pass: observed.pass,
        misses: Number.isFinite(observed.misses) ? observed.misses : null
      };
    }

    if (Number.isFinite(observed.misses)) {
      return {
        pass: observed.misses <= 0,
        misses: observed.misses
      };
    }
  }

  return {
    pass: null,
    misses: null
  };
};

/**
 * Validates security gate + redaction rule observed results against matrix
 * expectations, with blocking-vs-advisory enforcement handling.
 *
 * @param {object} [input]
 * @param {object} [input.securityGatesPayload]
 * @param {object} [input.redactionRulesPayload]
 * @param {object|Array<object>|Map<string,object>} [input.gateResults]
 * @param {object|Array<object>|Map<string,object>} [input.redactionResults]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrSecurityGateControls({
  securityGatesPayload,
  redactionRulesPayload,
  gateResults = {},
  redactionResults = {},
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const securityValidation = validateRegistry('usr-security-gates', securityGatesPayload);
  if (!securityValidation?.ok) {
    return emptyValidationResult(securityValidation?.errors || ['invalid usr-security-gates payload']);
  }

  const redactionValidation = validateRegistry('usr-redaction-rules', redactionRulesPayload);
  if (!redactionValidation?.ok) {
    return emptyValidationResult(redactionValidation?.errors || ['invalid usr-redaction-rules payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const securityRows = Array.isArray(securityGatesPayload?.rows) ? securityGatesPayload.rows : [];
  const redactionRows = Array.isArray(redactionRulesPayload?.rows) ? redactionRulesPayload.rows : [];
  const gateResultMap = normalizeObservedResultMap(gateResults, 'id');
  const redactionResultMap = normalizeObservedResultMap(redactionResults, 'id');

  for (const row of securityRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = gateResultMap.get(row.id) ?? gateResultMap.get(row.check) ?? null;
    const observedPass = resolveObservedGatePass(observed);
    const treatAsBlocking = Boolean(row.blocking || row.enforcement === 'strict');

    if (observedPass === null) {
      const message = `missing security-gate result for ${row.id} (${row.check})`;
      if (treatAsBlocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else if (!observedPass) {
      const message = `security-gate failed for ${row.id} (${row.check})`;
      if (treatAsBlocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings);
    }

    rows.push({
      rowType: 'security-gate',
      id: row.id,
      check: row.check,
      scope: row.scope,
      enforcement: row.enforcement,
      blocking: treatAsBlocking,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const row of redactionRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = redactionResultMap.get(row.id) ?? redactionResultMap.get(row.class) ?? null;
    const { pass: observedPass, misses } = resolveObservedRedactionResult(observed);

    if (observedPass === null) {
      const message = `missing redaction result for ${row.id} (${row.class})`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else if (!observedPass) {
      const suffix = Number.isFinite(misses) ? ` misses=${misses}` : '';
      const message = `redaction rule failed for ${row.id} (${row.class})${suffix}`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings);
    }

    rows.push({
      rowType: 'redaction-rule',
      id: row.id,
      class: row.class,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      misses: Number.isFinite(misses) ? misses : null,
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
 * Builds security gate validation report payload from evaluated row outcomes.
 *
 * @param {object} [input]
 * @param {object} [input.securityGatesPayload]
 * @param {object} [input.redactionRulesPayload]
 * @param {object|Array<object>|Map<string,object>} [input.gateResults]
 * @param {object|Array<object>|Map<string,object>} [input.redactionResults]
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
export function buildUsrSecurityGateValidationReport({
  securityGatesPayload,
  redactionRulesPayload,
  gateResults = {},
  redactionResults = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-security-gate-validator',
  producerVersion = null,
  runId = 'run-usr-security-gate-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const evaluation = validateUsrSecurityGateControls({
    securityGatesPayload,
    redactionRulesPayload,
    gateResults,
    redactionResults,
    validateRegistry
  });
  const rows = evaluation.rows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  }));

  let securityGateRowCount = 0;
  let redactionRuleRowCount = 0;
  let passCount = 0;
  let blockingFailureCount = 0;
  for (const row of rows) {
    if (row.rowType === 'security-gate') {
      securityGateRowCount += 1;
    } else if (row.rowType === 'redaction-rule') {
      redactionRuleRowCount += 1;
    }
    if (row.pass) {
      passCount += 1;
    } else if (row.blocking) {
      blockingFailureCount += 1;
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
    status: resolveReportStatus(evaluation),
    scope: normalizeScope(scope, 'lane', lane),
    summary: {
      rowCount: rows.length,
      securityGateRowCount,
      redactionRuleRowCount,
      passCount,
      failCount: rows.length - passCount,
      blockingFailureCount,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'security-gate',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'security-gate',
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
