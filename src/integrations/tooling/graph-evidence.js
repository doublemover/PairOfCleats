import path from 'node:path';
import { getRepoRoot, getRepoCacheRoot, getBuildsRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { assertNoSymlinkPath } from '../../shared/contained-file.js';
import { resolveCacheScopedBuildIdRoot } from '../../shared/indexing/build-pointer-roots.js';
import { assertGraphEvidence } from '../../contracts/validators/graph-evidence.js';
import { GRAPH_EVIDENCE_VERSION } from '../../contracts/schemas/graph-evidence.js';
import { prepareGraphEvidencePage } from './graph-helpers.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Explicit immutable build only; current pointers never redirect a cursor.
 * Canonical repo roots retain the existing process reader/cleanup exclusion.
 */
export const runGraphEvidence = async (request, { signal = null, userConfig = null } = {}) => {
  assertGraphEvidence('request', request);
  throwIfAborted(signal);
  const repoRoot = getRepoRoot(request.repoRoot);
  const config = userConfig || loadUserConfig(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, config);
  const buildsRoot = getBuildsRoot(repoRoot, config);
  const buildRoot = resolveCacheScopedBuildIdRoot(request.buildId, repoCacheRoot, buildsRoot);
  if (!buildRoot) throw Object.assign(new Error('Requested retained build is outside its repository cache.'), { code: 'ERR_GRAPH_EVIDENCE_GENERATION' });
  const indexDir = path.join(buildRoot, 'index-code');
  assertNoSymlinkPath(repoCacheRoot, indexDir);
  const maxBytes = request.limits?.bytes ?? 1048576;
  const page = await prepareGraphEvidencePage({ indexDir, expectedBuildId: request.buildId,
    family: request.family, filter: request.filter || {}, cursor: request.cursor ?? null,
    limit: request.limits?.rows ?? 128, scanRows: request.limits?.scanRows ?? 1024,
    maxPageBytes: maxBytes - 512, signal });
  const result = { schemaVersion: GRAPH_EVIDENCE_VERSION, ...page,
    coverage: { scope: 'retained-family', complete: page.done, upstream: 'not-asserted' } };
  assertGraphEvidence('result', result);
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw Object.assign(new Error('Graph evidence envelope exceeds requested bytes.'), { code: 'ERR_GRAPH_EVIDENCE_OUTPUT_BYTES' });
  throwIfAborted(signal);
  return result;
};

export const classifyGraphEvidenceError = error => {
  const code = error?.code || 'ERR_GRAPH_EVIDENCE';
  const status = code === 'ERR_GRAPH_EVIDENCE_CONTRACT' || /_CURSOR_SCOPE$|_PAGE_BYTES$/.test(code) ? 400
    : /GENERATION/.test(code) ? 409 : /PAGING_UNAVAILABLE$/.test(code) || code === 'ENOENT' ? 404
      : code === 'ERR_UNSAFE_FILE_PATH' ? 403 : error?.name === 'AbortError' ? 499 : 500;
  return { status, code, message: error?.message || 'Graph evidence failed.' };
};
