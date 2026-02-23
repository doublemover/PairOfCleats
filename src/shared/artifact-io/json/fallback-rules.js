import { getBakPath } from '../cache.js';
import {
  collectCompressedCandidates,
  collectCompressedJsonlCandidates,
  detectCompression
} from '../compression.js';

const toSource = (path, { compression = detectCompression(path), cleanup = false } = {}) => ({
  path,
  compression,
  cleanup
});

/**
 * Fallback order for `readJsonFile()`:
 * 1. primary path (cleanup stale `.bak` on success)
 * 2. compressed siblings for `.json` targets (`.zst`, `.gz`, then backups)
 * 3. primary `.bak`
 *
 * @param {string} filePath
 * @returns {{
 *   primary:{path:string,compression:string|null,cleanup:boolean},
 *   compressed:{path:string,compression:string|null,cleanup:boolean}[],
 *   backup:{path:string,compression:string|null,cleanup:boolean}
 * }}
 */
export const resolveJsonReadFallback = (filePath) => ({
  primary: toSource(filePath, { cleanup: true }),
  compressed: filePath.endsWith('.json') ? collectCompressedCandidates(filePath) : [],
  backup: toSource(getBakPath(filePath))
});

/**
 * Fallback order for async JSONL scan helpers (`readJsonLinesEach`):
 * 1. primary path
 * 2. primary `.bak`
 * 3. compressed sidecars for `.jsonl` targets
 *
 * @param {string} filePath
 * @returns {{
 *   primary:{path:string,compression:string|null,cleanup:boolean},
 *   backup:{path:string,compression:string|null,cleanup:boolean},
 *   compressed:{path:string,compression:string|null,cleanup:boolean}[]
 * }}
 */
export const resolveJsonlEachFallback = (filePath) => ({
  primary: toSource(filePath, { cleanup: true }),
  backup: toSource(getBakPath(filePath)),
  compressed: filePath.endsWith('.jsonl') ? collectCompressedJsonlCandidates(filePath) : []
});

/**
 * Fallback policy for array/sync materializers:
 * - If primary exists but fails, only `.bak` is eligible.
 * - Compressed sidecars are consulted only when both primary and `.bak` are
 *   missing.
 *
 * Caller enforces this conditional ordering; this helper only supplies the
 * candidate descriptors.
 *
 * @param {string} filePath
 * @returns {{
 *   primary:{path:string,compression:string|null,cleanup:boolean},
 *   backup:{path:string,compression:string|null,cleanup:boolean},
 *   compressed:{path:string,compression:string|null,cleanup:boolean}[]
 * }}
 */
export const resolveJsonlArraySyncFallback = (filePath) => ({
  primary: toSource(filePath, { cleanup: true }),
  backup: toSource(getBakPath(filePath)),
  compressed: filePath.endsWith('.jsonl') ? collectCompressedJsonlCandidates(filePath) : []
});

/**
 * Candidate resolution for iterator mode:
 * - For `.jsonl`, compressed sidecars take precedence and the plain source is
 *   skipped when at least one compressed candidate exists.
 * - For other targets, the requested path is used directly.
 *
 * @param {string} filePath
 * @returns {{path:string,compression:string|null,cleanup:boolean}[]}
 */
export const resolveJsonlIteratorSources = (filePath) => {
  if (!filePath.endsWith('.jsonl')) {
    return [toSource(filePath)];
  }
  const compressed = collectCompressedJsonlCandidates(filePath);
  return compressed.length ? compressed : [toSource(filePath)];
};
