import { renderRecordMarkdown } from '../../src/integrations/triage/render.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { writeTextIfChanged } from '../shared/generated-report.js';
import { resolveRecordArtifactPathSafe } from './context-pack-paths.js';
import fs from 'node:fs/promises';
import { stableStringify } from '../../src/shared/stable-json.js';

export async function writeTriageRecordArtifacts(recordsDir, record) {
  const recordId = record?.recordId;
  const jsonPath = resolveRecordArtifactPathSafe(recordsDir, recordId, '.json');
  const mdPath = resolveRecordArtifactPathSafe(recordsDir, recordId, '.md');
  if (!jsonPath || !mdPath) {
    const label = typeof recordId === 'string' ? JSON.stringify(recordId.slice(0, 256)) : '<non-string>';
    const error = new Error(`Invalid recordId path: ${label}`);
    error.code = 'ERR_TRIAGE_RECORD_ID_PATH';
    throw error;
  }

  if (record.idProvenance?.method === 'fallback-hash') {
    let existing;
    try { existing = JSON.parse(await fs.readFile(jsonPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Normalization supplies invocation timestamps when the raw payload has none.
    // They cannot distinguish otherwise identical repeat imports. Raw timestamp
    // fields, when retained, and every other persisted field still participate.
    const content = value => stableStringify({ ...value, createdAt: undefined, updatedAt: undefined });
    if (existing && content(existing) !== content(record)) {
      throw Object.assign(new Error(`Derived triage identity conflict for ${recordId}; existing artifacts were preserved.`), {
        code: 'ERR_TRIAGE_RECORD_IDENTITY_CONFLICT'
      });
    }
  }

  await writeJsonFileResolved(jsonPath, record);
  await writeTextIfChanged(mdPath, renderRecordMarkdown(record), { encoding: 'utf8' });
  return { jsonPath, mdPath };
}
