/**
 * Count newline-delimited lines, optionally short-circuiting past `maxLines`.
 *
 * @param {string} text
 * @param {number|null} [maxLines=null]
 * @returns {number}
 */
export const countLinesBounded = (text, maxLines = null) => {
  if (!text) return 0;
  const capped = Number.isFinite(Number(maxLines)) && Number(maxLines) > 0
    ? Math.floor(Number(maxLines))
    : null;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
    if (capped && count > capped) return count;
  }
  return count;
};

/**
 * Resolve per-language parser size limits.
 *
 * @param {{languageId?:string|null,treeSitterConfig?:object|null}} input
 * @returns {{maxBytes:unknown,maxLines:unknown}}
 */
export const resolveTreeSitterLimits = ({ languageId, treeSitterConfig }) => {
  const config = treeSitterConfig && typeof treeSitterConfig === 'object' ? treeSitterConfig : {};
  const perLanguage = (config.byLanguage && languageId && config.byLanguage[languageId]) || {};
  const maxBytes = perLanguage.maxBytes ?? config.maxBytes;
  const maxLines = perLanguage.maxLines ?? config.maxLines;
  return { maxBytes, maxLines };
};

/**
 * Check per-language tree-sitter max-bytes/max-lines guardrails.
 *
 * @param {{
 *  text:string,
 *  languageId:string|null,
 *  treeSitterConfig:object|null,
 *  onExceeded?:(details:object)=>void
 * }} input
 * @returns {boolean}
 */
export const exceedsTreeSitterLimits = ({
  text,
  languageId,
  treeSitterConfig,
  onExceeded = null
}) => {
  const { maxBytes, maxLines } = resolveTreeSitterLimits({ languageId, treeSitterConfig });
  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      if (typeof onExceeded === 'function') {
        onExceeded({ reason: 'max-bytes', languageId, bytes, maxBytes, maxLines });
      }
      return true;
    }
  }
  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = countLinesBounded(text, maxLines);
    if (lines > maxLines) {
      if (typeof onExceeded === 'function') {
        onExceeded({ reason: 'max-lines', languageId, lines, maxLines, maxBytes });
      }
      return true;
    }
  }
  return false;
};
