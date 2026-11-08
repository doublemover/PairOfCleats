import path from 'node:path';
import { getRepoRoot, getRepoCacheRoot, getBuildsRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { assertNoSymlinkPath } from '../../shared/contained-file.js';
import { resolveCacheScopedBuildIdRoot } from '../../shared/indexing/build-pointer-roots.js';
import { assertGraphEvidence } from '../../contracts/validators/graph-evidence.js';
import { GRAPH_EVIDENCE_VERSION } from '../../contracts/schemas/graph-evidence.js';
import { prepareGraphEvidencePage, prepareGraphEvidenceOperation } from './graph-helpers.js';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

/** Explicit immutable build only; current pointers never redirect a cursor.
 * Canonical repo roots retain the existing process reader/cleanup exclusion.
 */
const prepareRequest = (request, { signal = null, userConfig = null } = {}) => {
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
  return { maxBytes, options: { indexDir, expectedBuildId: request.buildId,
    family: request.family, filter: structuredClone(request.filter || {}), cursor: request.cursor ?? null,
    limit: request.limits?.rows ?? 128, scanRows: request.limits?.scanRows ?? 1024,
    maxPageBytes: maxBytes - 512, signal } };
};
const qualifyResult = (page, maxBytes, signal) => {
  const result = { schemaVersion: GRAPH_EVIDENCE_VERSION, ...page,
    coverage: { scope: 'retained-family', complete: page.done, upstream: 'not-asserted' } };
  assertGraphEvidence('result', result);
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw Object.assign(new Error('Graph evidence envelope exceeds requested bytes.'), { code: 'ERR_GRAPH_EVIDENCE_OUTPUT_BYTES' });
  throwIfAborted(signal);
  return result;
};

export const runGraphEvidence = async (request, context = {}) => {
  const { maxBytes, options } = prepareRequest(request, context);
  return qualifyResult(await prepareGraphEvidencePage(options), maxBytes, options.signal);
};

/** CLI-owned enumeration only. Independent HTTP/MCP calls retain single-page
 * verification. No retained descriptor or proof is stored in a public cursor.
 */
export const iterateGraphEvidence = async function* (request, context = {}) {
  const { maxBytes, options } = prepareRequest(request, context);
  const operation = await prepareGraphEvidenceOperation(options), iterator = operation.iteratePages();
  let done = false, primary, primaryPresent = false;
  try {
    while (true) {
      const entry = await iterator.next();
      if (entry.done) { done = true; break; }
      yield qualifyResult(operation.qualifyPage(entry.value), maxBytes, options.signal);
    }
  } catch (error) {
    primary = observeStorageResource(error, { phase: 'graph-evidence-enumeration' }).retain();
    primaryPresent = true;
    throw primary;
  } finally {
    if (!done) {
      try { await iterator.return(); }
      catch (error) { throw primaryPresent ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error; }
    }
  }
};

export { classifyGraphEvidenceError } from './graph-evidence-errors.js';
