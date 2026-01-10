import { buildTreeSitterChunks } from '../tree-sitter.js';

export function parseTreeSitter(payload = {}) {
  const { text = '', languageId = null, ext = null, treeSitter = null } = payload;
  try {
    return buildTreeSitterChunks({
      text,
      languageId,
      ext,
      options: { treeSitter }
    });
  } catch {
    return null;
  }
}
