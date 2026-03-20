import { USR_REPORT_SCHEMA_DEFS } from '../../schemas/usr.js';
import { validateUsrDiagnosticCode } from '../usr.js';
import { asStringArray } from './profile-helpers.js';
import {
  buildKnownCompensatingArtifacts,
  toFixedDays,
  toIsoDate
} from './report-shaping.js';
import { validateUsrMatrixRegistry } from './registry.js';

const USR_VERSION_PATTERN = /^usr-\d+\.\d+\.\d+$/;
const REQUIRED_BACKCOMPAT_IDS = Object.freeze(
  new Set(Array.from({ length: 12 }, (_, index) => `BC-${String(index + 1).padStart(3, '0')}`))
);

export function validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload,
  strictEnum = true
} = {}) {
  const matrixValidation = validateUsrMatrixRegistry('usr-backcompat-matrix', backcompatMatrixPayload);
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
      const diagnosticValidation = validateUsrDiagnosticCode(diagnostic, { strictEnum });
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
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrBackcompatMatrixCoverage({
    backcompatMatrixPayload,
    strictEnum
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
    artifactId: 'usr-backcompat-matrix-results',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
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

export function validateUsrThreatModelCoverage({
  threatModelPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload
} = {}) {
  const threatValidation = validateUsrMatrixRegistry('usr-threat-model-matrix', threatModelPayload);
  if (!threatValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...threatValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const fixtureValidation = validateUsrMatrixRegistry('usr-fixture-governance', fixtureGovernancePayload);
  if (!fixtureValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...fixtureValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const securityValidation = validateUsrMatrixRegistry('usr-security-gates', securityGatesPayload);
  if (!securityValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...securityValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const alertValidation = validateUsrMatrixRegistry('usr-alert-policies', alertPoliciesPayload);
  if (!alertValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...alertValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const redactionValidation = validateUsrMatrixRegistry('usr-redaction-rules', redactionRulesPayload);
  if (!redactionValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...redactionValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
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
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrThreatModelCoverage({
    threatModelPayload,
    fixtureGovernancePayload,
    securityGatesPayload,
    alertPoliciesPayload,
    redactionRulesPayload
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
    artifactId: 'usr-threat-model-coverage-report',
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

const WAIVER_SCOPE_TYPES = Object.freeze(new Set([
  'global',
  'lane',
  'language',
  'framework',
  'artifact',
  'phase'
]));

const WAIVER_APPROVER_PATTERN = /^(usr|language|framework)-[a-z0-9][a-z0-9-]*$/;
const WAIVER_EXPIRY_WARNING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DISALLOWED_WAIVER_CLASSES = Object.freeze(new Set([
  'strict-security-bypass',
  'schema-hard-block-bypass'
]));


export function validateUsrWaiverPolicyControls({
  waiverPolicyPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime = new Date().toISOString(),
  strictMode = true
} = {}) {
  const waiverValidation = validateUsrMatrixRegistry('usr-waiver-policy', waiverPolicyPayload);
  if (!waiverValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...waiverValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const ownershipValidation = validateUsrMatrixRegistry('usr-ownership-matrix', ownershipMatrixPayload);
  if (!ownershipValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...ownershipValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const escalationValidation = validateUsrMatrixRegistry('usr-escalation-policy', escalationPolicyPayload);
  if (!escalationValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...escalationValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const evaluationDate = toIsoDate(evaluationTime);
  if (!evaluationDate) {
    return {
      ok: false,
      errors: Object.freeze([`invalid evaluationTime timestamp: ${evaluationTime}`]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const waiverRows = Array.isArray(waiverPolicyPayload?.rows) ? waiverPolicyPayload.rows : [];
  const ownershipRows = Array.isArray(ownershipMatrixPayload?.rows) ? ownershipMatrixPayload.rows : [];
  const escalationRows = Array.isArray(escalationPolicyPayload?.rows) ? escalationPolicyPayload.rows : [];

  const knownArtifactIds = new Set(Object.keys(USR_REPORT_SCHEMA_DEFS));
  const knownCompensatingArtifacts = buildKnownCompensatingArtifacts({ ownershipRows });

  const governanceApprovers = new Set();
  for (const row of ownershipRows) {
    if (typeof row.ownerRole === 'string') {
      governanceApprovers.add(row.ownerRole);
    }
    if (typeof row.backupOwnerRole === 'string') {
      governanceApprovers.add(row.backupOwnerRole);
    }
  }
  for (const row of escalationRows) {
    for (const approver of asStringArray(row.requiredApprovers)) {
      governanceApprovers.add(approver);
    }
  }

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
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrWaiverPolicyControls({
    waiverPolicyPayload,
    ownershipMatrixPayload,
    escalationPolicyPayload,
    evaluationTime,
    strictMode
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
    artifactId: 'usr-waiver-active-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
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
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrWaiverPolicyControls({
    waiverPolicyPayload,
    ownershipMatrixPayload,
    escalationPolicyPayload,
    evaluationTime,
    strictMode
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
    artifactId: 'usr-waiver-expiry-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
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

