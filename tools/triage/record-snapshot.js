import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { resolveRecordPathSafe } from './context-pack-paths.js';
import { triageRecordContent } from '../../src/contracts/validators/triage-record-publication.js';

export const TRIAGE_RECORD_MAX_BYTES = 16 * 1024 * 1024;
const invalid = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });

/** A selection is bound to one closed, verified descriptor snapshot. There is
 * no ID-less compatibility path for a durable finding/decision selection.
 */
export const loadTriageRecordSnapshot = async (recordsDir, requestedId, { maxBytes = TRIAGE_RECORD_MAX_BYTES,
  recordType = null, signal = null } = {}) => {
  const id = typeof requestedId === 'string' ? requestedId.trim() : '';
  const file = resolveRecordPathSafe(recordsDir, id);
  if (!file) throw invalid('ERR_TRIAGE_RECORD_ID_PATH', 'Invalid triage record selection.');
  const source = await readVerifiedContainedFile(recordsDir, file, { maxBytes, hashAlgorithm: 'sha256', signal });
  let record;
  try { record = JSON.parse(source.buffer.toString('utf8')); }
  catch (cause) { throw invalid('ERR_TRIAGE_RECORD_INVALID', 'Malformed triage record JSON.', cause); }
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || !['finding', 'decision'].includes(record.recordType)
    || typeof record.source !== 'string' || !record.source.trim() || record.source.length > 4096
    || typeof record.recordId !== 'string' || !record.recordId
    || recordType !== null && record.recordType !== recordType) {
    throw invalid('ERR_TRIAGE_RECORD_INVALID', 'Selected triage record has an unsupported shape or kind.');
  }
  if (record.recordId !== id) throw invalid('ERR_TRIAGE_RECORD_IDENTITY', 'Selected triage record identity does not match its requested ID.');
  // Generic findings may carry source-specific extension fields. The receipt
  // versions its own observation, without inventing an outer record version.
  const provenance = record.idProvenance;
  const idProvenance = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
    ? Object.fromEntries(['method', 'stability', 'source'].filter(key => typeof provenance[key] === 'string'
      && provenance[key].length <= 128).map(key => [key, provenance[key]])) : null;
  const timestamp = value => typeof value === 'string' && value.length <= 128 ? value : null;
  const observation = Object.freeze({ schemaVersion: 1, recordId: id, recordType: record.recordType,
    source: record.source, hashAlgorithm: 'sha256', hash: source.hash, bytes: source.buffer.length,
    createdAt: timestamp(record.createdAt), updatedAt: timestamp(record.updatedAt),
    idProvenance: idProvenance ? Object.freeze(idProvenance) : null });
  return Object.freeze({ record: triageRecordContent(record), observation });
};
