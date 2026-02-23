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
 * Validates embedding-bridge fixture bundle coverage for required edge kinds
 * and diagnostics declared in bridge-case policy rows.
 *
 * @param {object} [input]
 * @param {object} [input.bridgeCasesPayload]
 * @param {object} [input.bridgeBundlePayload]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrEmbeddingBridgeCoverage({
  bridgeCasesPayload,
  bridgeBundlePayload,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const bridgeValidation = validateRegistry('usr-embedding-bridge-cases', bridgeCasesPayload);
  if (!bridgeValidation?.ok) {
    return emptyValidationResult(bridgeValidation?.errors || ['invalid usr-embedding-bridge-cases payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const caseRows = Array.isArray(bridgeCasesPayload?.rows) ? bridgeCasesPayload.rows : [];
  const bundleRows = Array.isArray(bridgeBundlePayload?.rows) ? bridgeBundlePayload.rows : [];
  const bundleByCaseId = new Map();

  for (const row of bundleRows) {
    const caseId = typeof row?.bridgeCaseId === 'string' ? row.bridgeCaseId : null;
    if (!caseId) {
      errors.push('bridge bundle row is missing bridgeCaseId');
      continue;
    }
    if (bundleByCaseId.has(caseId)) {
      errors.push(`duplicate bridgeCaseId in bundle: ${caseId}`);
      continue;
    }
    bundleByCaseId.set(caseId, row);
  }

  const expectedCaseIds = new Set(caseRows.map((row) => row.id));
  for (const caseRow of caseRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const bundleRow = bundleByCaseId.get(caseRow.id);

    if (!bundleRow) {
      rowErrors.push('missing bridge case in fixture bundle');
    } else {
      const edgeKinds = new Set(
        (Array.isArray(bundleRow.edges) ? bundleRow.edges : [])
          .map((edge) => edge?.kind)
          .filter((kind) => typeof kind === 'string')
      );
      const diagnosticCodes = new Set(
        (Array.isArray(bundleRow.diagnostics) ? bundleRow.diagnostics : [])
          .map((diagnostic) => diagnostic?.code)
          .filter((code) => typeof code === 'string')
      );

      for (const requiredEdgeKind of asStringArray(caseRow.requiredEdgeKinds)) {
        if (!edgeKinds.has(requiredEdgeKind)) {
          rowErrors.push(`missing required edge kind: ${requiredEdgeKind}`);
        }
      }

      for (const requiredDiagnostic of asStringArray(caseRow.requiredDiagnostics)) {
        if (!diagnosticCodes.has(requiredDiagnostic)) {
          rowErrors.push(`missing required diagnostic: ${requiredDiagnostic}`);
        }
      }

      if (edgeKinds.size === 0) {
        rowWarnings.push('bridge case bundle row has no edges');
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${caseRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${caseRow.id} ${message}`));
    }

    rows.push({
      rowType: 'embedding-bridge-coverage',
      bridgeCaseId: caseRow.id,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const bridgeCaseId of bundleByCaseId.keys()) {
    if (!expectedCaseIds.has(bridgeCaseId)) {
      errors.push(`fixture bundle includes unknown bridgeCaseId: ${bridgeCaseId}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

/**
 * Builds embedding-bridge coverage report payload from evaluated case rows.
 *
 * @param {object} [input]
 * @param {object} [input.bridgeCasesPayload]
 * @param {object} [input.bridgeBundlePayload]
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
export function buildUsrEmbeddingBridgeCoverageReport({
  bridgeCasesPayload,
  bridgeBundlePayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-embedding-bridge-coverage-builder',
  producerVersion = null,
  runId = 'run-usr-embedding-bridge-coverage',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const evaluation = validateUsrEmbeddingBridgeCoverage({
    bridgeCasesPayload,
    bridgeBundlePayload,
    validateRegistry
  });
  const rows = evaluation.rows.map((row) => ({
    ...row,
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
    status: resolveReportStatus(evaluation),
    scope: normalizeScope(scope, 'lane', lane),
    summary: {
      dashboard: 'embedding-bridge-coverage',
      rowCount: rows.length,
      passCount,
      failCount: rows.length - passCount,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'embedding-bridge',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'embedding-bridge',
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
