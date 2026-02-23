const USR_VERSION_PATTERN = /^usr-\d+\.\d+\.\d+$/;
const REQUIRED_BACKCOMPAT_IDS = Object.freeze(
  new Set(Array.from({ length: 12 }, (_, index) => `BC-${String(index + 1).padStart(3, '0')}`))
);

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
 * Validate the backcompat scenario matrix.
 *
 * @param {object} [input]
 * @param {object} [input.backcompatMatrixPayload]
 * @param {boolean} [input.strictEnum]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(code:string,input?:object)=>{ok:boolean,errors?:string[]}} input.validateDiagnosticCode
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload,
  strictEnum = true,
  validateRegistry,
  validateDiagnosticCode
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }
  if (typeof validateDiagnosticCode !== 'function') {
    return emptyValidationResult(['validateDiagnosticCode callback is required']);
  }

  const matrixValidation = validateRegistry('usr-backcompat-matrix', backcompatMatrixPayload);
  if (!matrixValidation?.ok) {
    return emptyValidationResult(matrixValidation?.errors || ['invalid usr-backcompat-matrix payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const matrixRows = Array.isArray(backcompatMatrixPayload?.rows) ? backcompatMatrixPayload.rows : [];
  const idCounts = new Map();
  const seenIds = new Set();

  for (const row of matrixRows) {
    idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
  }

  for (const row of matrixRows) {
    const rowErrors = [];
    const rowWarnings = [];

    seenIds.add(row.id);

    if ((idCounts.get(row.id) || 0) > 1) {
      rowErrors.push('backcompat row id must be unique');
    }

    if (!USR_VERSION_PATTERN.test(String(row.producerVersion || ''))) {
      rowErrors.push(`producerVersion must match usr-semver format: ${row.producerVersion}`);
    }

    const readerVersions = asStringArray(row.readerVersions);
    if (readerVersions.length === 0) {
      rowErrors.push('readerVersions must include at least one reader version');
    }

    for (const version of readerVersions) {
      if (!USR_VERSION_PATTERN.test(version)) {
        rowErrors.push(`readerVersion must match usr-semver format: ${version}`);
      }
    }

    const requiredDiagnostics = asStringArray(row.requiredDiagnostics);
    for (const diagnostic of requiredDiagnostics) {
      const diagnosticValidation = validateDiagnosticCode(diagnostic, { strictEnum });
      if (!diagnosticValidation.ok) {
        rowErrors.push(`requiredDiagnostics contains invalid code ${diagnostic}: ${diagnosticValidation.errors.join('; ')}`);
      }
    }

    if (row.expectedOutcome === 'accept-with-adapter') {
      if (row.readerMode !== 'non-strict') {
        rowErrors.push('accept-with-adapter rows must use readerMode=non-strict');
      }
      if (row.blocking !== false) {
        rowErrors.push('accept-with-adapter rows must be non-blocking');
      }
      if (!requiredDiagnostics.includes('USR-W-BACKCOMPAT-ADAPTER')) {
        rowWarnings.push('accept-with-adapter row should include USR-W-BACKCOMPAT-ADAPTER diagnostic');
      }
    }

    if (row.expectedOutcome === 'reject') {
      if (row.blocking !== true) {
        rowErrors.push('reject rows must be blocking');
      }
      if (requiredDiagnostics.length === 0) {
        rowErrors.push('reject rows must include at least one required diagnostic');
      }
    }

    if (row.expectedOutcome === 'accept' && row.blocking !== true) {
      rowWarnings.push('accept rows are expected to remain blocking for strict compatibility guarantees');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      readerMode: row.readerMode,
      expectedOutcome: row.expectedOutcome,
      blocking: Boolean(row.blocking),
      readerVersionCount: readerVersions.length,
      requiredDiagnostics,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const requiredId of REQUIRED_BACKCOMPAT_IDS) {
    if (!seenIds.has(requiredId)) {
      errors.push(`missing required backcompat scenario row: ${requiredId}`);
    }
  }

  const pairwiseExpandedRows = matrixRows.filter((row) => asStringArray(row.readerVersions).length > 1);
  if (pairwiseExpandedRows.length === 0) {
    errors.push('backcompat matrix must include at least one pairwise-expanded readerVersions row');
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrBackcompatMatrixReport({
  backcompatMatrixPayload,
  strictEnum = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-backcompat-validator',
  producerVersion = null,
  runId = 'run-usr-backcompat-matrix-results',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  validateDiagnosticCode,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const validation = validateUsrBackcompatMatrixCoverage({
    backcompatMatrixPayload,
    strictEnum,
    validateRegistry,
    validateDiagnosticCode
  });

  const rows = validation.rows.map((row) => ({
    id: row.id,
    readerMode: row.readerMode,
    expectedOutcome: row.expectedOutcome,
    blocking: row.blocking,
    readerVersionCount: row.readerVersionCount,
    requiredDiagnostics: row.requiredDiagnostics,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-backcompat-matrix-results',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(validation),
    scope: normalizeScope(scope, 'global', 'global'),
    summary: {
      scenarioCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      strictScenarioCount: rows.filter((row) => row.readerMode === 'strict').length,
      nonStrictScenarioCount: rows.filter((row) => row.readerMode === 'non-strict').length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'backcompat',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'backcompat',
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
