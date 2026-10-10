import fs from 'node:fs/promises';
import path from 'node:path';
import { assertRuntimeQuery } from '../../contracts/validators/runtime-query.js';
import { queryRuntimeEvidence } from '../../index/semantic/runtime/query.js';
import { listRuntimeFamilies } from '../../index/semantic/runtime/families.js';
import { runtimeImportError } from '../../index/semantic/runtime/raw-store.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { getRepoCacheRoot, loadUserConfig } from '../../shared/dict-utils.js';
import { isWithinRoot, toRealPath } from '../../workspace/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { projectIndexFormatError } from '../../shared/index-format-error.js';

/** The public destination is authorized by the same repository boundary as its request. */
export const resolveRuntimeEvidenceDestination = async ({ repoRoot, destination, userConfig = null }) => {
  const root = await toRealPath(getRepoRoot(repoRoot));
  const config = userConfig || loadUserConfig(root);
  const cacheRoot = await toRealPath(getRepoCacheRoot(root, config));
  const resolved = await toRealPath(path.resolve(root, destination));
  if (!isWithinRoot(resolved, root) && !isWithinRoot(resolved, cacheRoot)) {
    throw runtimeImportError('Runtime evidence destination is outside the authorized repository and repository cache.', 'ERR_RUNTIME_DESTINATION_FORBIDDEN');
  }
  try { if (!(await fs.stat(resolved)).isDirectory()) throw runtimeImportError('Runtime evidence destination is not a directory.', 'ERR_RUNTIME_FAMILY_UNAVAILABLE'); }
  catch (error) { if (error.code === 'ENOENT') throw runtimeImportError('Runtime evidence destination is unavailable.', 'ERR_RUNTIME_FAMILY_UNAVAILABLE'); throw error; }
  return resolved;
};
export const runRuntimeEvidenceLookup = async (payload, { signal = null, userConfig = null } = {}) => {
  assertRuntimeQuery('lookupRequest', payload); throwIfAborted(signal);
  const destination = await resolveRuntimeEvidenceDestination({ ...payload, userConfig });
  throwIfAborted(signal);
  return queryRuntimeEvidence({ destination, request: payload.request, signal });
};
export const runRuntimeFamilyDiscovery = async (payload, { signal = null, userConfig = null } = {}) => {
  assertRuntimeQuery('discoveryRequest', payload); throwIfAborted(signal);
  const destination = await resolveRuntimeEvidenceDestination({ ...payload, userConfig });
  throwIfAborted(signal);
  return listRuntimeFamilies({ destination, limit: payload.limits.maxFamilies, maxScan: payload.limits.maxScan,
    maxBytes: payload.limits.maxBytes, maxMs: payload.limits.maxMs, cursor: payload.cursor, signal });
};
export const classifyRuntimeEvidenceError = error => {
  const format = projectIndexFormatError(error);
  const code = error.code || 'ERR_RUNTIME_QUERY_FAILED';
  const status = format || ['ERR_RUNTIME_QUERY_SCOPE', 'ERR_RUNTIME_IMPORT_INTEGRITY', 'ERR_RUNTIME_QUERY_INDEX_UNAVAILABLE', 'ERR_RUNTIME_FAMILY_CONTRACT'].includes(code) ? 409
    : code === 'ERR_RUNTIME_DESTINATION_FORBIDDEN' ? 403 : code === 'ERR_RUNTIME_FAMILY_UNAVAILABLE' ? 404
      : code === 'ERR_RUNTIME_QUERY_CURSOR' ? 410 : code === 'ERR_RUNTIME_QUERY_BUDGET' ? 422
        : code === 'ABORT_ERR' ? 499 : code === 'ERR_RUNTIME_QUERY_CONTRACT' || error instanceof TypeError ? 400 : 500;
  return { status, code: format?.nativeCode || code, message: error.message || 'Runtime evidence lookup failed.', ...(format || {}) };
};
