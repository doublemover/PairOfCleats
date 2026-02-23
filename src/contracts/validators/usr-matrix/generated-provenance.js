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
 * Validates generated-provenance bundle coverage against expected matrix cases.
 *
 * @param {object} [input]
 * @param {object} [input.provenanceCasesPayload]
 * @param {object} [input.provenanceBundlePayload]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrGeneratedProvenanceCoverage({
  provenanceCasesPayload,
  provenanceBundlePayload,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const provenanceValidation = validateRegistry('usr-generated-provenance-cases', provenanceCasesPayload);
  if (!provenanceValidation?.ok) {
    return emptyValidationResult(provenanceValidation?.errors || ['invalid usr-generated-provenance-cases payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const caseRows = Array.isArray(provenanceCasesPayload?.rows) ? provenanceCasesPayload.rows : [];
  const bundleRows = Array.isArray(provenanceBundlePayload?.rows) ? provenanceBundlePayload.rows : [];
  const bundleByCaseId = new Map();

  for (const row of bundleRows) {
    const caseId = typeof row?.provenanceCaseId === 'string' ? row.provenanceCaseId : null;
    if (!caseId) {
      errors.push('generated provenance bundle row is missing provenanceCaseId');
      continue;
    }
    if (bundleByCaseId.has(caseId)) {
      errors.push(`duplicate provenanceCaseId in bundle: ${caseId}`);
      continue;
    }
    bundleByCaseId.set(caseId, row);
  }

  const expectedCaseIds = new Set(caseRows.map((row) => row.id));
  for (const caseRow of caseRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const bundleRow = bundleByCaseId.get(caseRow.id);
    let confidenceDowngradeCount = 0;

    if (!bundleRow) {
      rowErrors.push('missing provenance case in fixture bundle');
    } else {
      const diagnostics = Array.isArray(bundleRow.diagnostics) ? bundleRow.diagnostics : [];
      const diagnosticCodes = new Set(diagnostics.map((diagnostic) => diagnostic?.code).filter((code) => typeof code === 'string'));

      for (const requiredDiagnostic of asStringArray(caseRow.requiredDiagnostics)) {
        if (!diagnosticCodes.has(requiredDiagnostic)) {
          rowErrors.push(`missing required diagnostic: ${requiredDiagnostic}`);
        }
      }

      const provenanceEntries = Array.isArray(bundleRow.provenance) ? bundleRow.provenance : [];
      if (provenanceEntries.length === 0) {
        rowErrors.push('provenance bundle row has no provenance entries');
      }

      for (const entry of provenanceEntries) {
        if (entry?.mappingQuality !== 'exact' || (typeof entry?.confidence === 'number' && entry.confidence < 0.9)) {
          confidenceDowngradeCount += 1;
        }
      }

      if (caseRow.mappingExpectation === 'exact') {
        if (diagnostics.length > 0) {
          rowErrors.push('exact mapping expectation must not emit diagnostics');
        }
        if (confidenceDowngradeCount > 0) {
          rowErrors.push('exact mapping expectation must not contain confidence downgrades');
        }
      } else {
        if (diagnostics.length === 0) {
          rowErrors.push('approximate mapping expectation must emit diagnostics');
        }
        if (confidenceDowngradeCount === 0) {
          rowWarnings.push('approximate mapping expectation should include at least one confidence downgrade entry');
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${caseRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${caseRow.id} ${message}`));
    }

    rows.push({
      rowType: 'generated-provenance-coverage',
      provenanceCaseId: caseRow.id,
      mappingExpectation: caseRow.mappingExpectation,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const provenanceCaseId of bundleByCaseId.keys()) {
    if (!expectedCaseIds.has(provenanceCaseId)) {
      errors.push(`fixture bundle includes unknown provenanceCaseId: ${provenanceCaseId}`);
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
 * Builds generated-provenance coverage report payload from matrix+bundle input.
 *
 * @param {object} [input]
 * @param {object} [input.provenanceCasesPayload]
 * @param {object} [input.provenanceBundlePayload]
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
export function buildUsrGeneratedProvenanceCoverageReport({
  provenanceCasesPayload,
  provenanceBundlePayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-generated-provenance-coverage-builder',
  producerVersion = null,
  runId = 'run-usr-generated-provenance-coverage',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const evaluation = validateUsrGeneratedProvenanceCoverage({
    provenanceCasesPayload,
    provenanceBundlePayload,
    validateRegistry
  });
  const rows = evaluation.rows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  }));

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
      dashboard: 'generated-provenance-coverage',
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length,
      downgradeCaseCount: rows.filter((row) => row.mappingExpectation !== 'exact').length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'generated-provenance',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'generated-provenance',
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
