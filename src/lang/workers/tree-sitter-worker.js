import {
  buildTreeSitterChunks,
  getTreeSitterStats
} from '../tree-sitter.js';
import { resolveTreeSitterLanguageForExt } from '../tree-sitter/language-id.js';
import { isTreeSitterEnabled } from '../tree-sitter/options.js';

/**
 * Piscina worker entrypoint.
 *
 * Note: Worker threads do not share the main thread's module state.
 * Parsing always uses the native tree-sitter runtime in-thread.
 */
export async function parseTreeSitter(payload = {}) {
  const { text = '', languageId = null, ext = null, treeSitter = null } = payload;
  const strict = treeSitter?.strict === true;

  const resolvedId = resolveTreeSitterLanguageForExt(languageId, ext);
  if (resolvedId && !isTreeSitterEnabled({ treeSitter }, resolvedId)) {
    return null;
  }

  try {
    const result = buildTreeSitterChunks({
      text,
      languageId,
      ext,
      options: { treeSitter }
    });
    if (strict && (!Array.isArray(result) || result.length === 0)) {
      throw new Error(`Tree-sitter worker returned no chunks for ${resolvedId || languageId || 'unknown'}.`);
    }
    return result;
  } catch (err) {
    if (strict) throw err;
    return null;
  }
}

export function treeSitterWorkerStats() {
  return getTreeSitterStats();
}
