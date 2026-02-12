import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  USR_MATRIX_SCHEMA_DEFS,
  USR_MATRIX_ROW_SCHEMAS
} from '../schemas/usr-matrix.js';
import {
  validateUsrDiagnosticCode,
  validateUsrReasonCode
} from './usr.js';

const ajv = createAjv({
  dialect: '2020',
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const RUNTIME_CONFIG_LAYER_ORDER = Object.freeze([
  { key: 'policyFile', label: 'policy-file' },
  { key: 'env', label: 'env' },
  { key: 'argv', label: 'argv' }
]);

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const formatErrors = (validator) => (
  validator.errors ? validator.errors.map(formatError) : []
);

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const toBoolean = (value) => {
  if (typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'expected boolean' };
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return { ok: true, value: false };
  }
  return { ok: false, error: `invalid boolean literal: ${value}` };
};

const toInteger = (value) => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return { ok: false, error: `expected integer, received ${value}` };
    }
    return { ok: true, value };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'expected integer' };
  }
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return { ok: false, error: `invalid integer literal: ${value}` };
  }
  return { ok: true, value: Number.parseInt(normalized, 10) };
};

const toEnum = (value) => {
  if (typeof value !== 'string') {
    return { ok: false, error: 'expected enum string' };
  }
  return { ok: true, value };
};

const coerceRuntimeConfigValue = (row, rawValue) => {
  let coerced;
  if (row.valueType === 'boolean') {
    coerced = toBoolean(rawValue);
  } else if (row.valueType === 'integer') {
    coerced = toInteger(rawValue);
  } else if (row.valueType === 'enum') {
    coerced = toEnum(rawValue);
  } else {
    return { ok: false, error: `unsupported runtime config valueType: ${row.valueType}` };
  }

  if (!coerced.ok) {
    return coerced;
  }

  if (row.valueType === 'integer') {
    if (row.minValue != null && coerced.value < row.minValue) {
      return { ok: false, error: `value ${coerced.value} below minValue ${row.minValue}` };
    }
    if (row.maxValue != null && coerced.value > row.maxValue) {
      return { ok: false, error: `value ${coerced.value} above maxValue ${row.maxValue}` };
    }
  }

  if (row.valueType === 'enum' && Array.isArray(row.allowedValues)) {
    if (!row.allowedValues.includes(coerced.value)) {
      return { ok: false, error: `value ${coerced.value} not in allowedValues` };
    }
  }

  return coerced;
};

const validateUnknownRuntimeKeys = ({ sourceValues, sourceLabel, knownKeys, strictMode, errors, warnings }) => {
  if (!sourceValues || typeof sourceValues !== 'object') {
    return;
  }
  for (const key of Object.keys(sourceValues)) {
    if (knownKeys.has(key)) {
      continue;
    }
    const message = `unknown runtime config key at ${sourceLabel}: ${key}`;
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }
};

const applyRuntimeOverride = ({ row, layerLabel, rawValue, strictMode, errors, warnings }) => {
  const parsed = coerceRuntimeConfigValue(row, rawValue);
  if (parsed.ok) {
    return parsed;
  }

  const message = `invalid runtime config value for ${row.key} at ${layerLabel}: ${parsed.error}`;
  const disallowInStrictMode = row.strictModeBehavior === 'disallow';
  if (strictMode && disallowInStrictMode) {
    errors.push(message);
  } else {
    warnings.push(message);
  }

  return { ok: false, error: parsed.error };
};

export const USR_MATRIX_VALIDATORS = Object.freeze(
  Object.fromEntries(
    Object.entries(USR_MATRIX_SCHEMA_DEFS).map(([registryId, schema]) => [registryId, compileSchema(ajv, schema)])
  )
);

export function validateUsrMatrixRegistry(registryId, payload) {
  const validator = USR_MATRIX_VALIDATORS[registryId];
  if (!validator) {
    return { ok: false, errors: [`unknown USR matrix registry: ${registryId}`] };
  }
  const ok = Boolean(validator(payload));
  return { ok, errors: ok ? [] : formatErrors(validator) };
}

export function validateUsrMatrixFile(fileName, payload) {
  const registryId = fileName.endsWith('.json')
    ? fileName.slice(0, -'.json'.length)
    : fileName;
  return validateUsrMatrixRegistry(registryId, payload);
}

export function listUsrMatrixRegistryIds() {
  return Object.freeze([...Object.keys(USR_MATRIX_ROW_SCHEMAS)].sort());
}

export function resolveUsrRuntimeConfig({
  policyPayload,
  layers = {},
  strictMode = true
} = {}) {
  const policyValidation = validateUsrMatrixRegistry('usr-runtime-config-policy', policyPayload);
  const errors = [];
  const warnings = [];
  const values = {};
  const appliedByKey = {};

  if (!policyValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...policyValidation.errors]),
      warnings: Object.freeze(warnings),
      values: Object.freeze(values),
      appliedByKey: Object.freeze(appliedByKey)
    };
  }

  const rows = Array.isArray(policyPayload?.rows) ? policyPayload.rows : [];
  const rowsByKey = new Map();
  for (const row of rows) {
    if (rowsByKey.has(row.key)) {
      errors.push(`duplicate runtime config key in policy: ${row.key}`);
      continue;
    }
    rowsByKey.set(row.key, row);
  }

  for (const layer of RUNTIME_CONFIG_LAYER_ORDER) {
    validateUnknownRuntimeKeys({
      sourceValues: layers[layer.key],
      sourceLabel: layer.label,
      knownKeys: rowsByKey,
      strictMode,
      errors,
      warnings
    });
  }

  for (const row of rows) {
    values[row.key] = row.defaultValue;
    appliedByKey[row.key] = 'default';

    for (const layer of RUNTIME_CONFIG_LAYER_ORDER) {
      const sourceValues = layers[layer.key];
      if (!sourceValues || typeof sourceValues !== 'object') {
        continue;
      }
      if (!hasOwn(sourceValues, row.key)) {
        continue;
      }

      const parsed = applyRuntimeOverride({
        row,
        layerLabel: layer.label,
        rawValue: sourceValues[row.key],
        strictMode,
        errors,
        warnings
      });
      if (!parsed.ok) {
        continue;
      }

      values[row.key] = parsed.value;
      appliedByKey[row.key] = layer.label;
    }
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    values: Object.freeze(values),
    appliedByKey: Object.freeze(appliedByKey)
  };
}


export function validateUsrFeatureFlagConflicts({
  values = {},
  strictMode = true
} = {}) {
  const errors = [];
  const warnings = [];

  const addConflict = (message) => {
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  };

  const cutoverEnabled = values['usr.rollout.cutoverEnabled'] === true;
  const shadowReadEnabled = values['usr.rollout.shadowReadEnabled'] === true;
  if (cutoverEnabled && shadowReadEnabled) {
    addConflict('disallowed feature-flag conflict: usr.rollout.cutoverEnabled and usr.rollout.shadowReadEnabled cannot both be true');
  }

  if (strictMode && values['usr.strictMode.enabled'] === false) {
    errors.push('disallowed feature-flag value in strict mode: usr.strictMode.enabled cannot be false');
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings])
  };
}

export function buildUsrFeatureFlagStateReport({
  policyPayload,
  layers = {},
  strictMode = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-runtime-config-validator',
  producerVersion = null,
  runId = 'run-usr-feature-flag-state',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const resolved = resolveUsrRuntimeConfig({
    policyPayload,
    layers,
    strictMode
  });

  const conflictValidation = validateUsrFeatureFlagConflicts({
    values: resolved.values,
    strictMode
  });

  const errors = [
    ...resolved.errors,
    ...conflictValidation.errors
  ];
  const warnings = [
    ...resolved.warnings,
    ...conflictValidation.warnings
  ];

  const policyRows = Array.isArray(policyPayload?.rows) ? policyPayload.rows : [];
  const rows = policyRows.map((row) => ({
    id: row.id,
    key: row.key,
    value: resolved.values[row.key],
    source: resolved.appliedByKey[row.key] || 'default',
    valueType: row.valueType,
    rolloutClass: row.rolloutClass,
    strictModeBehavior: row.strictModeBehavior,
    requiresRestart: Boolean(row.requiresRestart),
    blocking: Boolean(row.blocking)
  }));

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const status = errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-feature-flag-state',
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
      keyCount: rows.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      conflictCount: conflictValidation.errors.length + conflictValidation.warnings.length
    },
    blockingFindings: errors.map((message) => ({
      class: 'runtime-config',
      message
    })),
    advisoryFindings: warnings.map((message) => ({
      class: 'runtime-config',
      message
    })),
    rows
  };

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    values: resolved.values,
    appliedByKey: resolved.appliedByKey,
    payload
  };
}

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
    rows: evaluation.rows,
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

    const families = asStringArray(row.families);
    if (families.length === 0) {
      rowErrors.push('families must include at least one fixture family');
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
    rows: validation.rows,
    payload
  };
}

const normalizeBenchmarkObservedResults = (results) => {
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

const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function validateUsrBenchmarkMethodology({
  benchmarkPolicyPayload,
  sloBudgetsPayload
} = {}) {
  const benchmarkPolicyValidation = validateUsrMatrixRegistry('usr-benchmark-policy', benchmarkPolicyPayload);
  if (!benchmarkPolicyValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...benchmarkPolicyValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const sloBudgetValidation = validateUsrMatrixRegistry('usr-slo-budgets', sloBudgetsPayload);
  if (!sloBudgetValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...sloBudgetValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const benchmarkRows = Array.isArray(benchmarkPolicyPayload?.rows) ? benchmarkPolicyPayload.rows : [];
  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];

  const idCounts = new Map();
  for (const row of benchmarkRows) {
    idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
  }

  const sloByLane = new Map();
  for (const row of sloRows) {
    if (sloByLane.has(row.laneId)) {
      warnings.push(`duplicate slo budget lane row; first row retained for laneId=${row.laneId}`);
      continue;
    }
    sloByLane.set(row.laneId, row);
  }

  for (const row of benchmarkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((idCounts.get(row.id) || 0) > 1) {
      rowErrors.push('benchmark policy id must be unique');
    }

    if (row.warmupRuns < 1) {
      rowErrors.push('warmupRuns must be >= 1 for deterministic methodology');
    }

    if (row.measureRuns < 3) {
      rowErrors.push('measureRuns must be >= 3 for deterministic percentile confidence');
    }

    const p50 = row?.percentileTargets?.p50DurationMs;
    const p95 = row?.percentileTargets?.p95DurationMs;
    const p99 = row?.percentileTargets?.p99DurationMs;
    if (!(p50 <= p95 && p95 <= p99)) {
      rowErrors.push('percentileTargets must satisfy p50 <= p95 <= p99');
    }

    if (row.maxVariancePct <= 0 || row.maxVariancePct > 100) {
      rowErrors.push('maxVariancePct must be in (0, 100]');
    }

    const sloBudget = sloByLane.get(row.laneId);
    if (!sloBudget) {
      if (row.blocking) {
        rowErrors.push(`blocking benchmark row requires matching slo budget laneId=${row.laneId}`);
      } else {
        rowWarnings.push(`non-blocking benchmark row has no matching slo budget laneId=${row.laneId}`);
      }
    } else {
      if (row.maxPeakMemoryMb > sloBudget.maxMemoryMb) {
        rowErrors.push(`benchmark maxPeakMemoryMb exceeds slo maxMemoryMb for laneId=${row.laneId}`);
      }
      if (row.percentileTargets.p95DurationMs > sloBudget.maxDurationMs) {
        rowErrors.push(`benchmark p95DurationMs exceeds slo maxDurationMs for laneId=${row.laneId}`);
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
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
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

export function evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload,
  sloBudgetsPayload,
  observedResults = {}
} = {}) {
  const methodology = validateUsrBenchmarkMethodology({
    benchmarkPolicyPayload,
    sloBudgetsPayload
  });

  const errors = [...methodology.errors];
  const warnings = [...methodology.warnings];

  const benchmarkRows = Array.isArray(benchmarkPolicyPayload?.rows) ? benchmarkPolicyPayload.rows : [];
  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];
  const sloByLane = new Map(sloRows.map((row) => [row.laneId, row]));
  const observedById = normalizeBenchmarkObservedResults(observedResults);

  const rows = [];

  for (const row of benchmarkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const observed = observedById.get(row.id);
    if (!observed) {
      if (row.blocking) {
        rowErrors.push('missing observed benchmark results for blocking row');
      } else {
        rowWarnings.push('missing observed benchmark results for non-blocking row');
      }
    }

    const p50Observed = toNumber(observed?.p50DurationMs);
    const p95Observed = toNumber(observed?.p95DurationMs);
    const p99Observed = toNumber(observed?.p99DurationMs);
    const varianceObserved = toNumber(observed?.variancePct);
    const peakMemoryObserved = toNumber(observed?.peakMemoryMb);

    const compare = ({ condition, message }) => {
      if (condition) {
        return;
      }
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    };

    if (observed) {
      compare({ condition: p50Observed != null, message: 'observed p50DurationMs must be numeric' });
      compare({ condition: p95Observed != null, message: 'observed p95DurationMs must be numeric' });
      compare({ condition: p99Observed != null, message: 'observed p99DurationMs must be numeric' });
      compare({ condition: varianceObserved != null, message: 'observed variancePct must be numeric' });
      compare({ condition: peakMemoryObserved != null, message: 'observed peakMemoryMb must be numeric' });

      if (p50Observed != null) {
        compare({ condition: p50Observed <= row.percentileTargets.p50DurationMs, message: `p50DurationMs regression: ${p50Observed} > ${row.percentileTargets.p50DurationMs}` });
      }
      if (p95Observed != null) {
        compare({ condition: p95Observed <= row.percentileTargets.p95DurationMs, message: `p95DurationMs regression: ${p95Observed} > ${row.percentileTargets.p95DurationMs}` });
      }
      if (p99Observed != null) {
        compare({ condition: p99Observed <= row.percentileTargets.p99DurationMs, message: `p99DurationMs regression: ${p99Observed} > ${row.percentileTargets.p99DurationMs}` });
      }
      if (varianceObserved != null) {
        compare({ condition: varianceObserved <= row.maxVariancePct, message: `variancePct regression: ${varianceObserved} > ${row.maxVariancePct}` });
      }
      if (peakMemoryObserved != null) {
        compare({ condition: peakMemoryObserved <= row.maxPeakMemoryMb, message: `peakMemoryMb regression: ${peakMemoryObserved} > ${row.maxPeakMemoryMb}` });
      }

      const sloBudget = sloByLane.get(row.laneId);
      if (sloBudget) {
        if (p95Observed != null) {
          compare({ condition: p95Observed <= sloBudget.maxDurationMs, message: `p95DurationMs exceeds slo maxDurationMs: ${p95Observed} > ${sloBudget.maxDurationMs}` });
        }
        if (peakMemoryObserved != null) {
          compare({ condition: peakMemoryObserved <= sloBudget.maxMemoryMb, message: `peakMemoryMb exceeds slo maxMemoryMb: ${peakMemoryObserved} > ${sloBudget.maxMemoryMb}` });
        }
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
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0 && rowWarnings.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings]),
      observed: observed || null
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrBenchmarkRegressionReport({
  benchmarkPolicyPayload,
  sloBudgetsPayload,
  observedResults = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-benchmark-regression-evaluator',
  producerVersion = null,
  runId = 'run-usr-benchmark-regression',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const evaluation = evaluateUsrBenchmarkRegression({
    benchmarkPolicyPayload,
    sloBudgetsPayload,
    observedResults
  });

  const rows = evaluation.rows.map((row) => ({
    id: row.id,
    laneId: row.laneId,
    blocking: row.blocking,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings,
    observed: row.observed
  }));

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
    artifactId: 'usr-benchmark-regression-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'benchmark-regression',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'benchmark-regression',
      message
    })),
    rows
  };

  return {
    ok: evaluation.ok,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows: evaluation.rows,
    payload
  };
}
export function validateUsrRuntimeConfigResolution(options = {}) {
  const resolved = resolveUsrRuntimeConfig(options);
  return {
    ok: resolved.ok,
    errors: resolved.errors,
    warnings: resolved.warnings,
    values: resolved.values,
    appliedByKey: resolved.appliedByKey
  };
}










