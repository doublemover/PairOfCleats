import {
  WAIVER_SCOPE_TYPES,
  WAIVER_APPROVER_PATTERN,
  WAIVER_EXPIRY_WARNING_WINDOW_MS,
  DISALLOWED_WAIVER_CLASSES,
  toIsoDate,
  toFixedDays,
  buildKnownUsrArtifactIds,
  buildKnownCompensatingArtifacts,
  buildGovernanceApprovers
} from './waiver-policy-helpers.js';

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
 * Validate a matrix payload through the caller-provided registry validator.
 *
 * Returns `null` when validation passes, otherwise the standardized failure payload.
 *
 * @param {{registryId:string, payload:unknown, validateRegistry:Function}} input
 * @returns {null|{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
const validateRegistryPayload = ({ registryId, payload, validateRegistry }) => {
  const validation = validateRegistry(registryId, payload);
  if (validation?.ok) {
    return null;
  }
  const errors = Array.isArray(validation?.errors)
    ? validation.errors
    : [`invalid ${registryId} matrix payload`];
  return emptyValidationResult(errors);
};

/**
 * Validate waiver policy rows against ownership/escalation governance controls.
 *
 * @param {object} [input]
 * @param {object} [input.waiverPolicyPayload]
 * @param {object} [input.ownershipMatrixPayload]
 * @param {object} [input.escalationPolicyPayload]
 * @param {string} [input.evaluationTime]
 * @param {boolean} [input.strictMode]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrWaiverPolicyControls({
  waiverPolicyPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime = new Date().toISOString(),
  strictMode = true,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const waiverValidation = validateRegistryPayload({
    registryId: 'usr-waiver-policy',
    payload: waiverPolicyPayload,
    validateRegistry
  });
  if (waiverValidation) {
    return waiverValidation;
  }

  const ownershipValidation = validateRegistryPayload({
    registryId: 'usr-ownership-matrix',
    payload: ownershipMatrixPayload,
    validateRegistry
  });
  if (ownershipValidation) {
    return ownershipValidation;
  }

  const escalationValidation = validateRegistryPayload({
    registryId: 'usr-escalation-policy',
    payload: escalationPolicyPayload,
    validateRegistry
  });
  if (escalationValidation) {
    return escalationValidation;
  }

  const evaluationDate = toIsoDate(evaluationTime);
  if (!evaluationDate) {
    return emptyValidationResult([`invalid evaluationTime timestamp: ${evaluationTime}`]);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const waiverRows = Array.isArray(waiverPolicyPayload?.rows) ? waiverPolicyPayload.rows : [];
  const ownershipRows = Array.isArray(ownershipMatrixPayload?.rows) ? ownershipMatrixPayload.rows : [];
  const escalationRows = Array.isArray(escalationPolicyPayload?.rows) ? escalationPolicyPayload.rows : [];

  const knownArtifactIds = buildKnownUsrArtifactIds();
  const knownCompensatingArtifacts = buildKnownCompensatingArtifacts({ ownershipRows });
  const governanceApprovers = buildGovernanceApprovers({
    ownershipRows,
    escalationRows
  });

  const waiverIdCounts = new Map();
  for (const row of waiverRows) {
    waiverIdCounts.set(row.id, (waiverIdCounts.get(row.id) || 0) + 1);
  }

  for (const row of waiverRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((waiverIdCounts.get(row.id) || 0) > 1) {
      rowErrors.push('waiver id must be unique within waiver-policy matrix');
    }

    if (!WAIVER_SCOPE_TYPES.has(row.scopeType)) {
      rowErrors.push(`unsupported scopeType: ${row.scopeType}`);
    }

    if (row.scopeType === 'artifact' && !knownArtifactIds.has(row.scopeId)) {
      rowErrors.push(`artifact scopeId is not a known USR report artifact: ${row.scopeId}`);
    }

    if (DISALLOWED_WAIVER_CLASSES.has(row.waiverClass)) {
      rowErrors.push(`waiverClass is disallowed by policy: ${row.waiverClass}`);
    }

    const approvers = asStringArray(row.approvers);
    if (approvers.length === 0) {
      rowErrors.push('approvers must contain at least one approver role');
    }

    const approverSet = new Set(approvers);
    if (approverSet.size !== approvers.length) {
      rowErrors.push('approvers must be unique within a waiver row');
    }

    for (const approver of approvers) {
      if (!WAIVER_APPROVER_PATTERN.test(approver)) {
        rowErrors.push(`approver id must match governance naming policy: ${approver}`);
      }
    }

    if (row.blocking) {
      if (approvers.length < 2) {
        rowErrors.push('blocking waivers require at least two approvers');
      }
      if (!approvers.some((approver) => governanceApprovers.has(approver))) {
        rowErrors.push('blocking waivers require at least one approver in ownership/escalation governance roles');
      }
    }

    const compensatingControls = asStringArray(row.requiredCompensatingControls);
    if (compensatingControls.length === 0) {
      rowErrors.push('requiredCompensatingControls must include at least one evidence artifact');
    }

    for (const artifactFile of compensatingControls) {
      if (!artifactFile.endsWith('.json')) {
        rowErrors.push(`compensating control must reference a JSON evidence artifact: ${artifactFile}`);
        continue;
      }
      if (!knownCompensatingArtifacts.has(artifactFile)) {
        const message = `compensating control does not map to a governed report artifact: ${artifactFile}`;
        if (strictMode || row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }
    }

    const allowedUntilDate = toIsoDate(row.allowedUntil);
    let isExpired = false;
    let expiresInDays = null;
    let expiresSoon = false;

    if (!allowedUntilDate) {
      rowErrors.push(`allowedUntil must be a valid ISO 8601 timestamp: ${row.allowedUntil}`);
    } else {
      const deltaMs = allowedUntilDate.getTime() - evaluationDate.getTime();
      isExpired = deltaMs <= 0;
      expiresInDays = toFixedDays(deltaMs);
      expiresSoon = !isExpired && deltaMs <= WAIVER_EXPIRY_WARNING_WINDOW_MS;

      if (isExpired) {
        const message = `waiver is expired at evaluationTime=${evaluationDate.toISOString()}`;
        if (strictMode || row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      } else if (expiresSoon) {
        rowWarnings.push('waiver expires within 14 days and requires renewal planning');
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
      waiverClass: row.waiverClass,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      blocking: Boolean(row.blocking),
      allowedUntil: row.allowedUntil,
      isExpired,
      expiresSoon,
      expiresInDays,
      approvers,
      requiredCompensatingControls: compensatingControls,
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

export function buildUsrWaiverActiveReport({
  waiverPolicyPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime = new Date().toISOString(),
  strictMode = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-waiver-policy-validator',
  producerVersion = null,
  runId = 'run-usr-waiver-active-report',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const validation = validateUsrWaiverPolicyControls({
    waiverPolicyPayload,
    ownershipMatrixPayload,
    escalationPolicyPayload,
    evaluationTime,
    strictMode,
    validateRegistry
  });

  const activeRows = validation.rows.filter((row) => row.isExpired === false);
  const rows = activeRows.map((row) => ({
    id: row.id,
    waiverClass: row.waiverClass,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    blocking: row.blocking,
    allowedUntil: row.allowedUntil,
    expiresSoon: row.expiresSoon,
    expiresInDays: row.expiresInDays,
    approvers: row.approvers,
    requiredCompensatingControls: row.requiredCompensatingControls,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-waiver-active-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(validation),
    scope: normalizeScope(scope, 'global', 'global'),
    summary: {
      evaluationTime,
      waiverCount: validation.rows.length,
      activeCount: rows.length,
      blockingActiveCount: rows.filter((row) => row.blocking).length,
      expiringSoonCount: rows.filter((row) => row.expiresSoon).length,
      failCount: rows.filter((row) => row.pass === false).length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'waiver-policy',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'waiver-policy',
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

export function buildUsrWaiverExpiryReport({
  waiverPolicyPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime = new Date().toISOString(),
  strictMode = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-waiver-policy-validator',
  producerVersion = null,
  runId = 'run-usr-waiver-expiry-report',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const validation = validateUsrWaiverPolicyControls({
    waiverPolicyPayload,
    ownershipMatrixPayload,
    escalationPolicyPayload,
    evaluationTime,
    strictMode,
    validateRegistry
  });

  const rows = validation.rows.map((row) => ({
    id: row.id,
    waiverClass: row.waiverClass,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    blocking: row.blocking,
    allowedUntil: row.allowedUntil,
    isExpired: row.isExpired,
    expiresSoon: row.expiresSoon,
    expiresInDays: row.expiresInDays,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-waiver-expiry-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(validation),
    scope: normalizeScope(scope, 'global', 'global'),
    summary: {
      evaluationTime,
      waiverCount: rows.length,
      expiredCount: rows.filter((row) => row.isExpired).length,
      expiringSoonCount: rows.filter((row) => row.expiresSoon).length,
      blockingExpiredCount: rows.filter((row) => row.blocking && row.isExpired).length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'waiver-policy',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'waiver-policy',
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
