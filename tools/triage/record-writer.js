import { renderRecordMarkdown } from '../../src/integrations/triage/render.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { writeTextIfChanged } from '../shared/generated-report.js';
import { resolveRecordArtifactPathSafe } from './context-pack-paths.js';

export async function writeTriageRecordArtifacts(recordsDir, record) {
  const recordId = record?.recordId;
  const jsonPath = resolveRecordArtifactPathSafe(recordsDir, recordId, '.json');
  const mdPath = resolveRecordArtifactPathSafe(recordsDir, recordId, '.md');
  if (!jsonPath || !mdPath) {
    const error = new Error(`Invalid recordId path: ${recordId}`);
    error.code = 'ERR_TRIAGE_RECORD_ID_PATH';
    throw error;
  }

  await writeJsonFileResolved(jsonPath, record);
  await writeTextIfChanged(mdPath, renderRecordMarkdown(record), { encoding: 'utf8' });
  return { jsonPath, mdPath };
}
