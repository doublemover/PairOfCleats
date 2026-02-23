import { shouldSkipPhrasePostingsForChunk } from '../../state.js';

const BOILERPLATE_SCAN_WINDOW_CHARS = 8192;
const BOILERPLATE_COMMENT_HINT_RX = /(?:^|\n)\s*(?:\/\/|\/\*|#|;|--|<!--|\*)/;

/**
 * Cheap preflight for boilerplate detection to avoid full-file scans when
 * license/generated-comment metadata cannot apply.
 *
 * @param {{mode:string,text:string,chunkCount:number,relPath:string}} input
 * @returns {boolean}
 */
export const shouldDetectBoilerplateBlocks = ({ mode, text, chunkCount, relPath }) => {
  if (mode !== 'code') return false;
  if (!Number.isFinite(Number(chunkCount)) || Number(chunkCount) <= 0) return false;
  const relPathLower = typeof relPath === 'string' ? relPath.toLowerCase() : null;
  if (shouldSkipPhrasePostingsForChunk({ file: relPath }, relPathLower)) return false;
  if (typeof text !== 'string' || !text) return false;
  const head = text.slice(0, BOILERPLATE_SCAN_WINDOW_CHARS);
  if (BOILERPLATE_COMMENT_HINT_RX.test(head)) return true;
  if (text.length <= BOILERPLATE_SCAN_WINDOW_CHARS) return false;
  const tail = text.slice(-BOILERPLATE_SCAN_WINDOW_CHARS);
  return BOILERPLATE_COMMENT_HINT_RX.test(tail);
};
