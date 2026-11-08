import { STOP } from '../../constants.js';
import { capturePunctuationTokens, splitId, splitWordsWithDict, stem } from '../../../shared/tokenize.js';
import { buildSequenceFromTokens } from './stream-helpers.js';

const normalizeToken = (value) => {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) return value.normalize('NFKD');
  }
  return value;
};

const PROSE_DICT_SPLIT_BYPASS_EXTS = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.less',
  '.map',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml'
]);

/**
 * Build tokens and optional synonym-expanded sequence for indexing.
 * @param {{text:string,mode:'code'|'prose',ext?:string,dictWords:Set<string>|{size:number,has:function},dictConfig:object,buffers?:object,includeSeq?:boolean}} input
 * @returns {{tokens:string[],seq:string[]}}
 */
export function buildTokenSequence({
  text,
  mode,
  ext,
  dictWords,
  dictConfig,
  buffers = null,
  includeCodePunctuation = true,
  includeSeq = true,
  countOnly = false
}) {
  const useBuffers = !!buffers && !countOnly;
  const tokensOut = countOnly ? null : useBuffers ? buffers.tokens : [];
  const seqOut = includeSeq && !countOnly ? (useBuffers ? buffers.seq : []) : null;
  const scratch = useBuffers ? buffers.scratch : [];
  const scratch2 = useBuffers ? buffers.scratch2 : [];
  if (useBuffers) {
    tokensOut.length = 0;
    if (buffers.seq) buffers.seq.length = 0;
    scratch.length = 0;
    scratch2.length = 0;
  }

  const baseTokens = splitId(text);
  for (const token of baseTokens) {
    scratch.push(normalizeToken(token));
  }
  let punctuation = null;
  if (mode === 'code' && includeCodePunctuation) {
    const captured = capturePunctuationTokens(text);
    punctuation = captured.coverage;
    for (const token of captured.tokens) scratch.push(token);
  }

  let working = scratch;
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  const skipDictSegmentation = mode === 'prose'
    && (normalizedExt === '.md' || PROSE_DICT_SPLIT_BYPASS_EXTS.has(normalizedExt));
  if (!skipDictSegmentation) {
    for (const token of working) {
      const parts = splitWordsWithDict(token, dictWords, dictConfig);
      if (Array.isArray(parts) && parts.length) {
        for (const part of parts) scratch2.push(part);
      }
    }
    working = scratch2;
  }

  let tokenCount = 0;
  if (mode === 'prose') {
    for (const token of working) {
      if (STOP.has(token)) continue;
      if (countOnly) { tokenCount += 2; continue; }
      tokensOut.push(token);
      tokensOut.push(stem(token));
    }
  } else {
    for (const token of working) { if (countOnly) tokenCount++; else tokensOut.push(token); }
  }
  if (countOnly) return { tokens: [], seq: [], tokenCount };

  // When buffers are supplied we still return cloned output arrays so callers
  // can retain per-chunk token lists without being mutated by the next chunk.
  const tokens = useBuffers ? tokensOut.slice() : tokensOut;
  if (!includeSeq) {
    return { tokens, seq: [], ...(punctuation ? { punctuation } : {}) };
  }
  const seq = buildSequenceFromTokens(tokens, seqOut);
  return {
    tokens,
    seq,
    ...(punctuation ? { punctuation } : {})
  };
}

/** Exact emitted-token cardinality, including duplicates/stems, without output arrays. */
export const countTokenSequence = input => buildTokenSequence({ ...input, countOnly: true, includeSeq: false }).tokenCount;
