import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  USR_SCHEMA_DEFS,
  USR_EVIDENCE_ENVELOPE_SCHEMA,
  USR_REPORT_SCHEMA_DEFS,
  USR_CAPABILITY_TRANSITION_SCHEMA
} from '../schemas/usr.js';

const ajv = createAjv({
  dialect: '2020',
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const EDGE_ENDPOINT_ENTITY_TO_ID_TYPE = Object.freeze({
  document: 'docUid',
  segment: 'segmentUid',
  node: 'nodeUid',
  symbol: 'symbolUid'
});

export const USR_CANONICAL_DIAGNOSTIC_CODES = Object.freeze(new Set([
  'USR-E-PARSER-UNAVAILABLE',
  'USR-E-PARSER-FAILED',
  'USR-E-SEGMENT-INVALID-RANGE',
  'USR-E-SCHEMA-VIOLATION',
  'USR-E-CAPABILITY-LOST',
  'USR-E-ID-GRAMMAR-VIOLATION',
  'USR-E-EDGE-ENDPOINT-INVALID',
  'USR-E-RANGE-MAPPING-FAILED',
  'USR-E-DETERMINISM-DRIFT',
  'USR-E-PROFILE-CONFLICT',
  'USR-E-SECURITY-GATE-FAILED',
  'USR-E-SLO-BUDGET-FAILED',
  'USR-E-SERIALIZATION-NONCANONICAL',
  'USR-W-PARTIAL-PARSE',
  'USR-W-CAPABILITY-DOWNGRADED',
  'USR-W-FRAMEWORK-PROFILE-INCOMPLETE',
  'USR-W-REFERENCE-AMBIGUOUS',
  'USR-W-RESOLUTION-CANDIDATE-CAPPED',
  'USR-W-HEURISTIC-BINDING',
  'USR-W-TRUNCATED-FLOW',
  'USR-W-CANONICALIZATION-FALLBACK',
  'USR-I-FALLBACK-HEURISTIC',
  'USR-I-LEGACY-ADAPTER-APPLIED',
  'USR-I-COMPAT-MINOR-IGNORED'
]));

export const USR_CANONICAL_REASON_CODES = Object.freeze(new Set([
  'USR-R-NAME-NOT-FOUND',
  'USR-R-MULTIPLE-CANDIDATES',
  'USR-R-SCOPE-MISMATCH',
  'USR-R-TYPE-MISMATCH',
  'USR-R-MODULE-NOT-LOADED',
  'USR-R-PARSER-TIMEOUT',
  'USR-R-PARSER-UNAVAILABLE',
  'USR-R-DYNAMIC-DISPATCH',
  'USR-R-FRAMEWORK-VIRTUAL-BINDING',
  'USR-R-ROUTE-PATTERN-CONFLICT',
  'USR-R-TEMPLATE-SLOT-LATE-BIND',
  'USR-R-STYLE-SCOPE-UNKNOWN',
  'USR-R-CROSS-LANG-BRIDGE-PARTIAL',
  'USR-R-HEURISTIC-ONLY',
  'USR-R-RESOLUTION-CONFLICT',
  'USR-R-REDACTION-REQUIRED',
  'USR-R-CANDIDATE-CAP-EXCEEDED',
  'USR-R-RESOURCE-BUDGET-EXCEEDED',
  'USR-R-SECURITY-GATE-BLOCKED',
  'USR-R-SERIALIZATION-INVALID'
]));

export const USR_CANONICAL_ID_PATTERNS = Object.freeze({
  docUid: '^doc64:v1:[a-f0-9]{16}$',
  segmentUid: '^segu:v1:[a-f0-9]{16}$',
  nodeUid: '^n64:v1:[a-f0-9]{16}$',
  symbolUid: '^symu:v1:[a-z0-9:_\\-.]+$',
  edgeUid: '^edge64:v1:[a-f0-9]{16}$',
  routeUid: '^route64:v1:[a-f0-9]{16}$',
  scopeUid: '^scope64:v1:[a-f0-9]{16}$',
  diagnosticUid: '^diag64:v1:[a-f0-9]{16}$'
});

const USR_CANONICAL_ID_REGEX = Object.freeze(
  Object.fromEntries(
    Object.entries(USR_CANONICAL_ID_PATTERNS).map(([idType, pattern]) => [idType, new RegExp(pattern)])
  )
);

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const formatErrors = (validator) => (
  validator.errors ? validator.errors.map(formatError) : []
);

const normalizeEdgeKindConstraintRows = (edgeKindConstraints) => {
  if (Array.isArray(edgeKindConstraints)) {
    return edgeKindConstraints;
  }
  if (Array.isArray(edgeKindConstraints?.rows)) {
    return edgeKindConstraints.rows;
  }
  return [];
};

const buildEdgeKindConstraintMap = (edgeKindConstraints) => new Map(
  normalizeEdgeKindConstraintRows(edgeKindConstraints)
    .filter((row) => row && typeof row === 'object' && typeof row.edgeKind === 'string')
    .map((row) => [row.edgeKind, row])
);

const validateEdgeEndpointRef = ({ label, ref, allowedEntities, errors }) => {
  if (!ref || typeof ref !== 'object') {
    errors.push(`${label} ref must be an object`);
    return;
  }

  const entity = ref.entity;
  if (typeof entity !== 'string') {
    errors.push(`${label}.entity must be a string`);
    return;
  }

  if (Array.isArray(allowedEntities) && !allowedEntities.includes(entity)) {
    errors.push(`${label}.entity=${entity} not allowed by edge-kind constraints`);
  }

  const uid = ref.uid;
  const idType = EDGE_ENDPOINT_ENTITY_TO_ID_TYPE[entity];
  if (!idType) {
    errors.push(`${label}.entity=${entity} has no canonical ID mapping`);
    return;
  }

  const uidResult = validateUsrCanonicalId(idType, uid);
  if (!uidResult.ok) {
    errors.push(...uidResult.errors.map((error) => `${label}.uid ${error}`));
  }
};

export const USR_VALIDATORS = Object.freeze(
  Object.fromEntries(
    Object.entries(USR_SCHEMA_DEFS).map(([name, schema]) => [name, compileSchema(ajv, schema)])
  )
);

const REPORT_VALIDATORS = Object.freeze(
  Object.fromEntries(
    Object.keys(USR_REPORT_SCHEMA_DEFS).map((name) => [name, USR_VALIDATORS[name]])
  )
);

const EVIDENCE_ENVELOPE_VALIDATOR = compileSchema(ajv, USR_EVIDENCE_ENVELOPE_SCHEMA);
const CAPABILITY_TRANSITION_VALIDATOR = compileSchema(ajv, USR_CAPABILITY_TRANSITION_SCHEMA);

export const USR_REQUIRED_AUDIT_REPORT_IDS = Object.freeze([
  'usr-conformance-summary',
  'usr-validation-report',
  'usr-release-readiness-scorecard',
  'usr-feature-flag-state',
  'usr-failure-injection-report',
  'usr-benchmark-regression-summary',
  'usr-threat-model-coverage-report',
  'usr-waiver-active-report',
  'usr-waiver-expiry-report'
]);

export function validateUsrSchema(name, payload) {
  const validator = USR_VALIDATORS[name];
  if (!validator) {
    return { ok: false, errors: [`unknown USR schema: ${name}`] };
  }
  const ok = Boolean(validator(payload));
  return { ok, errors: ok ? [] : formatErrors(validator) };
}

export function validateUsrEvidenceEnvelope(payload) {
  const ok = Boolean(EVIDENCE_ENVELOPE_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(EVIDENCE_ENVELOPE_VALIDATOR) };
}

export function validateUsrReport(artifactId, payload) {
  const validator = REPORT_VALIDATORS[artifactId];
  if (!validator) {
    return { ok: false, errors: [`unknown USR report schema: ${artifactId}`] };
  }
  const ok = Boolean(validator(payload));
  return { ok, errors: ok ? [] : formatErrors(validator) };
}

export function listUsrReportIds() {
  return Object.freeze([...Object.keys(REPORT_VALIDATORS)].sort());
}

const getReportPayload = (reportsByArtifactId, artifactId) => {
  if (!reportsByArtifactId || typeof reportsByArtifactId !== 'object') {
    return undefined;
  }
  if (reportsByArtifactId instanceof Map) {
    return reportsByArtifactId.get(artifactId);
  }
  return reportsByArtifactId[artifactId];
};

export function validateUsrRequiredAuditReports(
  reportsByArtifactId,
  { requiredArtifactIds = USR_REQUIRED_AUDIT_REPORT_IDS } = {}
) {
  const errors = [];
  const rows = [];

  for (const artifactId of requiredArtifactIds) {
    const payload = getReportPayload(reportsByArtifactId, artifactId);
    if (payload == null) {
      const message = `missing required audit report payload: ${artifactId}`;
      errors.push(message);
      rows.push({
        artifactId,
        present: false,
        pass: false,
        errors: Object.freeze([message])
      });
      continue;
    }

    const validation = validateUsrReport(artifactId, payload);
    if (!validation.ok) {
      errors.push(...validation.errors.map((error) => `${artifactId} ${error}`));
    }

    rows.push({
      artifactId,
      present: true,
      pass: validation.ok,
      errors: Object.freeze([...validation.errors])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    rows: Object.freeze(rows)
  };
}

export function validateUsrCapabilityTransition(payload, { strictReasonCode = true } = {}) {
  const ok = Boolean(CAPABILITY_TRANSITION_VALIDATOR(payload));
  const errors = ok ? [] : formatErrors(CAPABILITY_TRANSITION_VALIDATOR);
  if (!ok) {
    return { ok: false, errors };
  }

  if (payload?.reasonCode != null) {
    const reasonValidation = validateUsrReasonCode(payload.reasonCode, { strictEnum: strictReasonCode });
    if (!reasonValidation.ok) {
      return { ok: false, errors: [...reasonValidation.errors] };
    }
  }

  return { ok: true, errors: [] };
}

export function validateUsrCanonicalId(idType, value) {
  const regex = USR_CANONICAL_ID_REGEX[idType];
  if (!regex) {
    return { ok: false, errors: [`unknown canonical ID type: ${idType}`] };
  }
  if (typeof value !== 'string') {
    return { ok: false, errors: [`${idType} must be a string`] };
  }
  if (!regex.test(value)) {
    return { ok: false, errors: [`${idType} does not match canonical grammar`] };
  }
  return { ok: true, errors: [] };
}

export function validateUsrDiagnosticCode(code, { strictEnum = true } = {}) {
  if (typeof code !== 'string') {
    return { ok: false, errors: ['diagnostic code must be a string'] };
  }
  if (!/^USR-[EWI]-[A-Z0-9-]+$/.test(code)) {
    return { ok: false, errors: ['diagnostic code does not match canonical grammar'] };
  }
  if (strictEnum && !USR_CANONICAL_DIAGNOSTIC_CODES.has(code)) {
    return { ok: false, errors: [`unknown diagnostic code: ${code}`] };
  }
  return { ok: true, errors: [] };
}

export function validateUsrReasonCode(reasonCode, { strictEnum = true } = {}) {
  if (typeof reasonCode !== 'string') {
    return { ok: false, errors: ['reason code must be a string'] };
  }
  if (!/^USR-R-[A-Z0-9-]+$/.test(reasonCode)) {
    return { ok: false, errors: ['reason code does not match canonical grammar'] };
  }
  if (strictEnum && !USR_CANONICAL_REASON_CODES.has(reasonCode)) {
    return { ok: false, errors: [`unknown reason code: ${reasonCode}`] };
  }
  return { ok: true, errors: [] };
}

export function validateUsrEdgeEndpoint(edge, edgeKindConstraints) {
  const errors = [];
  if (!edge || typeof edge !== 'object') {
    return { ok: false, errors: ['edge must be an object'] };
  }

  const edgeUidResult = validateUsrCanonicalId('edgeUid', edge.edgeUid);
  if (!edgeUidResult.ok) {
    errors.push(...edgeUidResult.errors.map((error) => `edgeUid ${error}`));
  }

  const edgeKind = typeof edge.kind === 'string'
    ? edge.kind
    : (typeof edge.edgeKind === 'string' ? edge.edgeKind : null);
  if (!edgeKind) {
    errors.push('edge kind must be provided as edge.kind or edge.edgeKind');
    return { ok: false, errors };
  }

  const constraintsByKind = buildEdgeKindConstraintMap(edgeKindConstraints);
  const constraint = constraintsByKind.get(edgeKind);
  if (!constraint) {
    errors.push(`edge kind not present in constraint table: ${edgeKind}`);
    return { ok: false, errors };
  }

  const source = edge.source ?? null;
  const target = edge.target ?? null;
  if (edge.status === 'resolved') {
    if (!source) {
      errors.push('resolved edge must include source ref');
    }
    if (!target) {
      errors.push('resolved edge must include target ref');
    }
  }

  if (source) {
    validateEdgeEndpointRef({
      label: 'source',
      ref: source,
      allowedEntities: constraint.sourceEntityKinds,
      errors
    });
  }

  if (target) {
    validateEdgeEndpointRef({
      label: 'target',
      ref: target,
      allowedEntities: constraint.targetEntityKinds,
      errors
    });
  }

  if (source && target && source.entity === target.entity && source.uid === target.uid) {
    if (edgeKind !== 'ast_parent') {
      errors.push(`self-edge is only allowed for ast_parent; received ${edgeKind}`);
    } else if (typeof edge?.attrs?.selfLoopReason !== 'string' || edge.attrs.selfLoopReason.trim() === '') {
      errors.push('ast_parent self-edge requires attrs.selfLoopReason');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateUsrEdgeEndpoints(edges, edgeKindConstraints) {
  if (!Array.isArray(edges)) {
    return { ok: false, errors: ['edges must be an array'] };
  }

  const errors = [];
  edges.forEach((edge, index) => {
    const result = validateUsrEdgeEndpoint(edge, edgeKindConstraints);
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `edge[${index}] ${error}`));
    }
  });

  return { ok: errors.length === 0, errors };
}
