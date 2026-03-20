import {
  validateUsrDiagnosticCode,
  validateUsrReasonCode
} from '../usr.js';
import { asStringArray } from './profile-helpers.js';
import { validateUsrMatrixRegistry } from './registry.js';

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

const validateScenarioCodeArrays = ({
  scenarioId,
  mode,
  diagnostics,
  reasonCodes,
  strictEnum,
  errors
}) => {
  for (const diagnostic of diagnostics) {
    const diagnosticValidation = validateUsrDiagnosticCode(diagnostic, { strictEnum });
    if (!diagnosticValidation.ok) {
      errors.push(`${scenarioId} ${mode} diagnostic invalid: ${diagnosticValidation.errors.join('; ')}`);
    }
  }

  for (const reasonCode of reasonCodes) {
    const reasonValidation = validateUsrReasonCode(reasonCode, { strictEnum });
    if (!reasonValidation.ok) {
      errors.push(`${scenarioId} ${mode} reasonCode invalid: ${reasonValidation.errors.join('; ')}`);
    }
  }
};

export function evaluateUsrFailureInjectionScenarios({
  matrixPayload,
  strictScenarioResults = {},
  nonStrictScenarioResults = {},
  strictEnum = true
} = {}) {
  const matrixValidation = validateUsrMatrixRegistry('usr-failure-injection-matrix', matrixPayload);
  if (!matrixValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...matrixValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
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

    if (strictObserved) {
      if (strictObserved.outcome !== row.strictExpectedOutcome) {
        rowErrors.push(`strict outcome mismatch: expected ${row.strictExpectedOutcome}, received ${strictObserved.outcome}`);
      }
    }

    if (nonStrictObserved) {
      if (nonStrictObserved.outcome !== row.nonStrictExpectedOutcome) {
        rowErrors.push(`non-strict outcome mismatch: expected ${row.nonStrictExpectedOutcome}, received ${nonStrictObserved.outcome}`);
      }
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
      errors: rowErrors
    });

    validateScenarioCodeArrays({
      scenarioId: row.id,
      mode: 'non-strict',
      diagnostics: nonStrictDiagnostics,
      reasonCodes: nonStrictReasonCodes,
      strictEnum,
      errors: rowErrors
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
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const evaluation = evaluateUsrFailureInjectionScenarios({
    matrixPayload,
    strictScenarioResults,
    nonStrictScenarioResults,
    strictEnum
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
  const status = evaluation.errors.length > 0
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
        scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
        scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
      }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-failure-injection-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
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

export function validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload
} = {}) {
  const matrixValidation = validateUsrMatrixRegistry('usr-fixture-governance', fixtureGovernancePayload);
  if (!matrixValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...matrixValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
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

    if (row.blocking === true && reviewers.filter((reviewer) => reviewer !== row.owner).length === 0) {
      rowErrors.push('blocking fixture rows must include at least one reviewer distinct from owner');
    }

    if (row.blocking === true) {
      const expectedOwnerPrefixByProfileType = {
        language: 'language-',
        framework: 'framework-',
        'cross-cutting': 'usr-'
      };
      const expectedPrefix = expectedOwnerPrefixByProfileType[row.profileType];
      if (expectedPrefix && !String(row.owner || '').startsWith(expectedPrefix)) {
        rowErrors.push(`blocking fixture row owner must use prefix ${expectedPrefix}`);
      }
      if (!reviewers.some((reviewer) => reviewer === 'usr-architecture' || reviewer === 'usr-conformance')) {
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

export function buildUsrFixtureGovernanceValidationReport({
  fixtureGovernancePayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-fixture-governance-validator',
  producerVersion = null,
  runId = 'run-usr-fixture-governance-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrFixtureGovernanceControls({ fixtureGovernancePayload });

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

  const status = validation.errors.length > 0
    ? 'fail'
    : (validation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
        scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
        scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
      }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-validation-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      validationDomain: 'fixture-governance',
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
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

