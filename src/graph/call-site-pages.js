import { validateArtifact } from '../contracts/artifact-schemas.js';
import { createRetainedEvidencePages } from './retained-evidence-pages.js';

const normalizeFilter = filter => {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)
    || Object.keys(filter).some(key => !['file', 'callerChunkUid', 'targetChunkUid', 'resolution', 'chunkUid', 'direction'].includes(key))) {
    throw new TypeError('Unknown call-site page filter.');
  }
  const output = {};
  for (const key of ['file', 'callerChunkUid', 'targetChunkUid', 'chunkUid']) {
    if (filter[key] == null) { output[key] = null; continue; }
    if (typeof filter[key] !== 'string' || !filter[key] || filter[key].length > 4096) throw new TypeError('Invalid call-site identity filter.');
    output[key] = filter[key];
  }
  output.resolution = filter.resolution ?? null;
  if (output.resolution !== null && !['resolved', 'ambiguous', 'unresolved'].includes(output.resolution)) throw new TypeError('Invalid call-site resolution filter.');
  output.direction = filter.direction ?? 'both';
  if (!['out', 'in', 'both'].includes(output.direction)) throw new TypeError('Invalid call-site direction.');
  if (!output.chunkUid && output.direction !== 'both') throw new TypeError('Directional call-site queries require a chunk identity.');
  return output;
};
const resolution = row => row.extensions?.syntax?.resolution
  || (row.targetChunkUid ? 'resolved' : row.targetCandidates?.length ? 'ambiguous' : 'unresolved');
const matches = (row, filter) => (!filter.file || row.file === filter.file)
  && (!filter.callerChunkUid || row.callerChunkUid === filter.callerChunkUid)
  && (!filter.targetChunkUid || row.targetChunkUid === filter.targetChunkUid)
  && (!filter.resolution || resolution(row) === filter.resolution)
  && (!filter.chunkUid || (filter.direction !== 'in' && row.callerChunkUid === filter.chunkUid)
    || (filter.direction !== 'out' && row.targetChunkUid === filter.chunkUid));

/** Canonical occurrence pages retain unresolved facts independently of adjacency. */
export const createCallSitePages = options => createRetainedEvidencePages({ ...options,
  family: 'call_sites', ordering: 'canonical-call-sites-physical-v1', errorPrefix: 'CALL_SITE',
  normalizeFilter, matches,
  validateRow: row => validateArtifact('call_sites', [row]).ok
});
