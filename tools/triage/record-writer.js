import { publishTriageRecord } from '../../src/integrations/triage/record-publication.js';
import { resolveRecordArtifactPathSafe } from './context-pack-paths.js';

export async function writeTriageRecordArtifacts(recordsDir, record, options = {}) {
  const recordId = record?.recordId;
  const jsonPath = resolveRecordArtifactPathSafe(recordsDir, recordId, '.json');
  const mdPath = resolveRecordArtifactPathSafe(recordsDir, recordId, '.md');
  if (!jsonPath || !mdPath) {
    const label = typeof recordId === 'string' ? JSON.stringify(recordId.slice(0, 256)) : '<non-string>';
    const error = new Error(`Invalid recordId path: ${label}`);
    error.code = 'ERR_TRIAGE_RECORD_ID_PATH';
    throw error;
  }
  return publishTriageRecord(recordsDir, record, options);
}
