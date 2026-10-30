import { SYN } from '../../constants.js';
import { capturePunctuationTokens, PUNCTUATION_TOKEN_LIMIT } from '../../../shared/tokenize.js';

export const buildSequenceFromTokens = (tokens, seqBuffer = null) => {
  if (!Array.isArray(tokens) || !tokens.length) return [];
  let hasSynonyms = false;
  for (let i = 0; i < tokens.length; i += 1) {
    if (Object.hasOwn(SYN, tokens[i]) && typeof SYN[tokens[i]] === 'string' && SYN[tokens[i]]) {
      hasSynonyms = true;
      break;
    }
  }
  if (!hasSynonyms) {
    return tokens.slice();
  }
  const seq = seqBuffer || [];
  if (seqBuffer) seqBuffer.length = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    seq.push(token);
    if (Object.hasOwn(SYN, token) && typeof SYN[token] === 'string' && SYN[token]) seq.push(SYN[token]);
  }
  return seqBuffer ? seq.slice() : seq;
};

/**
 * Pre-tokenize an entire file into per-line token arrays for cheap window slicing.
 * @param {{text:string,mode:'code'|'prose',ext?:string,dictWords:Set<string>|{size:number,has:function},dictConfig:object}} input
 * @param {function} buildTokenSequence
 * @returns {{lineTokens:string[][],linePunctuationTokens:string[][]|null}}
 */
export const createFileLineTokenStreamInternal = ({
  text,
  mode,
  ext,
  dictWords,
  dictConfig
}, buildTokenSequence) => {
  const lines = typeof text === 'string' ? text.split('\n') : [];
  const lineTokens = new Array(lines.length);
  const linePunctuationTokens = mode === 'code' ? new Array(lines.length) : null;
  const linePunctuationTruncated = mode === 'code' ? new Uint8Array(lines.length) : null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const built = buildTokenSequence({
      text: line,
      mode,
      ext,
      dictWords,
      dictConfig,
      includeCodePunctuation: false,
      includeSeq: false
    });
    lineTokens[i] = Array.isArray(built?.tokens) ? built.tokens : [];
    if (linePunctuationTokens) {
      const captured = capturePunctuationTokens(line);
      linePunctuationTokens[i] = captured.tokens;
      linePunctuationTruncated[i] = captured.coverage.truncated ? 1 : 0;
    }
  }
  return { lineTokens, linePunctuationTokens, linePunctuationTruncated };
};

/**
 * Slice a pre-tokenized file-line stream into one chunk token payload.
 * @param {{stream:{lineTokens:string[][],linePunctuationTokens?:string[][]|null},startLine:number,endLine:number}} input
 * @returns {{tokens:string[],seq:string[]}|null}
 */
export const sliceFileLineTokenStreamInternal = ({ stream, startLine, endLine }) => {
  const lineTokens = Array.isArray(stream?.lineTokens) ? stream.lineTokens : null;
  if (!lineTokens) return null;
  const linePunctuationTokens = Array.isArray(stream?.linePunctuationTokens)
    ? stream.linePunctuationTokens
    : null;
  const start = Math.max(1, Math.floor(Number(startLine) || 1));
  const end = Math.max(start, Math.floor(Number(endLine) || start));
  const tokens = [];
  const appendList = (list, length = list.length) => {
    for (let i = 0; i < length; i += 1) tokens.push(list[i]);
  };
  for (let line = start; line <= end; line += 1) {
    const list = lineTokens[line - 1];
    if (Array.isArray(list) && list.length) appendList(list);
  }
  let punctuation = null;
  if (linePunctuationTokens) {
    punctuation = { limit: PUNCTUATION_TOKEN_LIMIT, emitted: 0, truncated: false };
    for (let line = start; line <= end; line += 1) {
      const list = linePunctuationTokens[line - 1];
      if (Array.isArray(list) && list.length) {
        const length = Math.min(list.length, PUNCTUATION_TOKEN_LIMIT - punctuation.emitted);
        appendList(list, length); punctuation.emitted += length;
        if (length < list.length || stream.linePunctuationTruncated?.[line - 1]) punctuation.truncated = true;
        if (punctuation.emitted === PUNCTUATION_TOKEN_LIMIT && punctuation.truncated) break;
      }
    }
  }
  return { tokens, seq: buildSequenceFromTokens(tokens), ...(punctuation ? { punctuation } : {}) };
};
