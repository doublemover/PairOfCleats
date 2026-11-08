import path from 'node:path';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';

export const SERVICE_BUILD_STATE_MAX_BYTES = 1024 * 1024;
export const SERVICE_BUILD_STATE_FILE = 'build_state.json';
export const resolveServiceBuildStatePath = buildRoot => buildRoot ? path.join(buildRoot, SERVICE_BUILD_STATE_FILE) : null;

/** A completed contained read owns bytes before UTF8 decode/JSON parse. Ordinary
 * absence/corruption/read failure stays distinct; pending original cleanup is
 * rethrown by the storage observer and cannot become a harmless missing state.
 */
export const observeServiceBuildStateSnapshot = async (buildRoot, { signal = null } = {}) => {
  const statePath = resolveServiceBuildStatePath(buildRoot);
  if (!statePath) return { status: 'missing', path: null, bytes: null, jsonDecodes: 0, code: 'ENOENT' };
  let bytes = null, jsonDecodes = 0, phase = 'read';
  try {
    const read = await readVerifiedContainedFile(buildRoot, statePath, { maxBytes: SERVICE_BUILD_STATE_MAX_BYTES, signal });
    bytes = read.buffer.length;
    phase = 'decode';
    const text = new TextDecoder('utf8', { fatal: true }).decode(read.buffer);
    jsonDecodes++;
    phase = 'parse';
    const state = JSON.parse(text);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new SyntaxError('Build progress state requires an object.');
    return { status: 'ok', state, path: statePath, bytes, jsonDecodes, code: null };
  } catch (error) {
    const failure = describeStorageFailure(error, { phase: 'service-build-state-read',
      defaultCode: phase === 'read' ? 'ERR_BUILD_STATE_READ' : 'ERR_BUILD_STATE_CORRUPT' });
    if (failure.code === 'ABORT_ERR' || failure.code === 'ERR_ABORTED') throw error;
    const status = failure.code === 'ENOENT' || failure.code === 'ENOTDIR' ? 'missing'
      : ['ERR_FILE_TOO_LARGE', 'ERR_JSON_TOO_LARGE', 'JSON_TOO_LARGE'].includes(failure.code) ? 'oversized'
        : failure.code === 'ERR_UNSAFE_FILE_PATH' || failure.code === 'ERR_FILE_CHANGED' ? 'unsafe'
          : phase !== 'read' ? 'corrupt' : 'transient';
    return { status, path: statePath, bytes, jsonDecodes, code: failure.code };
  }
};

/** Compatibility callers retain their nullable snapshot contract. */
export const readServiceBuildStateSnapshot = async (buildRoot, options) => {
  const observation = await observeServiceBuildStateSnapshot(buildRoot, options);
  return observation.status === 'ok' ? { state: observation.state, path: observation.path } : null;
};
