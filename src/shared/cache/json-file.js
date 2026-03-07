import { readJsonFileSafe, readJsonFileSyncSafe } from '../files.js';

/**
 * Read a bounded JSON file (sync) and preserve structured read/parse failure.
 *
 * @param {string} filePath
 * @param {{fallback?:any,maxBytes?:number|null}} [options]
 * @returns {{data:any,error:unknown|null,phase:'stat'|'read'|'parse'|null}}
 */
export const loadBoundedJsonFileSync = (
  filePath,
  { fallback = null, maxBytes = null } = {}
) => {
  let readError = null;
  let readPhase = null;
  const data = readJsonFileSyncSafe(filePath, {
    fallback,
    maxBytes,
    onError: (info) => {
      if (!readPhase && typeof info?.phase === 'string') readPhase = info.phase;
      if (!readError) readError = info?.error || new Error('json_read_failed');
    }
  });
  return { data, error: readError, phase: readPhase };
};

/**
 * Read a bounded JSON file (async) and preserve structured read/parse failure.
 *
 * @param {string} filePath
 * @param {{fallback?:any,maxBytes?:number|null}} [options]
 * @returns {Promise<{data:any,error:unknown|null,phase:'stat'|'read'|'parse'|null}>}
 */
export const loadBoundedJsonFile = async (
  filePath,
  { fallback = null, maxBytes = null } = {}
) => {
  let readError = null;
  let readPhase = null;
  const data = await readJsonFileSafe(filePath, {
    fallback,
    maxBytes,
    onError: (info) => {
      if (!readPhase && typeof info?.phase === 'string') readPhase = info.phase;
      if (!readError) readError = info?.error || new Error('json_read_failed');
    }
  });
  return { data, error: readError, phase: readPhase };
};
