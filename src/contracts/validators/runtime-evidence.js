import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { RUNTIME_SCHEMAS } from '../schemas/runtime-evidence.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = new Map(Object.entries(RUNTIME_SCHEMAS).map(([key, schema]) => [key, compileSchema(ajv, schema)]));
export const assertRuntimeEvidence = (kind, value) => {
  const validate = validators.get(kind);
  if (!validate) throw new TypeError('Unknown runtime contract: ' + kind);
  if (!validate(value)) throw Object.assign(new TypeError('Invalid runtime ' + kind + ': ' + ajv.errorsText(validate.errors)), { code: 'ERR_RUNTIME_EVIDENCE_CONTRACT' });
  const fail = (message) => { throw Object.assign(new TypeError(message), { code: 'ERR_RUNTIME_EVIDENCE_CONTRACT' }); };
  if (kind === 'rawArtifact' && value.retained !== (value.storageRef !== null)) fail('Raw artifact retention/reference mismatch.');
  if (kind === 'capture') {
    const ids = new Set();
    for (const raw of value.rawArtifacts) {
      assertRuntimeEvidence('rawArtifact', raw);
      if (raw.captureId !== value.captureId || ids.has(raw.artifactId)) fail('Capture artifact identity mismatch.');
      ids.add(raw.artifactId);
    }
  }
  if (kind === 'evidence') {
    if (value.join.quality === 'exact-source' && (!value.join.sourceUnitId || !value.join.sourceHash)) fail('Exact join requires source identity and hash.');
    if (value.join.quality === 'unresolved' && value.join.targets.length) fail('Unresolved join cannot assert targets.');
    if (value.kind !== 'derivedClaim' && !value.rawRefs.length) fail('Direct observation requires raw evidence.');
    if (value.data.key && (value.data.key.sessionId !== value.scope.sessionId || value.data.key.processId !== value.scope.processId)) fail('Code lifetime scope mismatch.');
    if (value.timestamp && value.timestamp.clockDomain !== value.clock.domain) fail('Timestamp clock mismatch.');
    for (const range of [value.data.sourceRange, value.data.generatedRange, value.data.range, ...value.rawRefs.map(row => row.byteRange)]) {
      if (range && range.end < range.start) fail('Runtime range must be half-open and ordered.');
    }
  }
  return value;
};

/** Validate joins at the capture boundary before any normalized projection is published. */
export const assertRuntimeProjection = ({ capture, evidence }) => {
  assertRuntimeEvidence('capture', capture);
  const raw = new Map(capture.rawArtifacts.map(row => [row.artifactId, row]));
  const ids = new Set();
  for (const record of evidence) {
    assertRuntimeEvidence('evidence', record);
    if (record.captureId !== capture.captureId || ids.has(record.evidenceId)
      || record.workload.fingerprint !== capture.workload.fingerprint
      || record.workload.phase !== capture.workload.phase) {
      throw Object.assign(new TypeError('Runtime projection capture/workload identity mismatch.'), { code: 'ERR_RUNTIME_EVIDENCE_JOIN' });
    }
    ids.add(record.evidenceId);
    for (const reference of record.rawRefs) {
      const artifact = raw.get(reference.artifactId);
      if (!artifact || artifact.hash !== reference.hash || (reference.byteRange && reference.byteRange.end > artifact.byteLength)) {
        throw Object.assign(new TypeError('Runtime raw evidence reference mismatch.'), { code: 'ERR_RUNTIME_EVIDENCE_JOIN' });
      }
    }
    if (record.join.quality === 'exact-source' && !capture.sources.some(source => source.sourceUnitId === record.join.sourceUnitId && source.byteHash === record.join.sourceHash)) {
      throw Object.assign(new TypeError('Runtime source join is outside the capture snapshot.'), { code: 'ERR_RUNTIME_EVIDENCE_JOIN' });
    }
  }
  for (const record of evidence) if (record.kind === 'derivedClaim') {
    for (const id of [...record.data.supportingEvidenceIds, ...record.data.contradictingEvidenceIds]) {
      if (!ids.has(id) || id === record.evidenceId) throw Object.assign(new TypeError('Derived claim references unavailable or self evidence.'), { code: 'ERR_RUNTIME_EVIDENCE_JOIN' });
    }
  }
  return { captureId: capture.captureId, recordCount: evidence.length };
};
