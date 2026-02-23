import { SYN } from '../../constants.js';
import { extractPunctuationTokens } from '../../../shared/tokenize.js';

export const buildSequenceFromTokens = (tokens, seqBuffer = null) => {
  if (!Array.isArray(tokens) || !tokens.length) return [];
  let hasSynonyms = false;
  for (let i = 0; i < tokens.length; i += 1) {
    if (SYN[tokens[i]]) {
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
    if (SYN[token]) seq.push(SYN[token]);
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
      linePunctuationTokens[i] = extractPunctuationTokens(line);
    }
  }
  return { lineTokens, linePunctuationTokens };
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
  const appendList = (list) => {
    for (let i = 0; i < list.length; i += 1) tokens.push(list[i]);
  };
  for (let line = start; line <= end; line += 1) {
    const list = lineTokens[line - 1];
    if (Array.isArray(list) && list.length) appendList(list);
  }
  if (linePunctuationTokens) {
    for (let line = start; line <= end; line += 1) {
      const list = linePunctuationTokens[line - 1];
      if (Array.isArray(list) && list.length) appendList(list);
    }
  }
  return { tokens, seq: buildSequenceFromTokens(tokens) };
};
