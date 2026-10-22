import { lineColToOffset } from '../../../shared/lines.js';

/** Protocol lines use LF, CRLF and lone CR; U+2028/U+2029 remain characters. */
export const buildLspLineIndex = text => {
  const source=String(text ?? ''), starts=[0];
  for(let index=0;index<source.length;index++) {
    if(source[index] === '\r') {if(source[index+1] === '\n')index++;starts.push(index+1);}
    else if(source[index] === '\n')starts.push(index+1);
  }
  return starts;
};
const protocolIndexes=new WeakMap();
export const getLspLineIndex = (text,owner=null) => {
  if(!owner || typeof owner !== 'object')return buildLspLineIndex(text);
  const cached=protocolIndexes.get(owner);
  if(cached?.text === text)return cached.starts;
  const starts=buildLspLineIndex(text);protocolIndexes.set(owner,{text,starts});return starts;
};
export const offsetToLspPosition = (lineIndex,text,offset,encoding='utf-16') => {
  if(!Number.isSafeInteger(offset) || offset<0 || offset>text.length)throw new RangeError('Invalid LSP source offset.');
  let low=0,high=lineIndex.length;
  while(low+1<high) {const mid=(low+high)>>>1;if(lineIndex[mid]<=offset)low=mid;else high=mid;}
  const window=resolveLineWindow(lineIndex,text,low), prefix=text.slice(window.start,Math.min(offset,window.end));
  const normalized=normalizePositionEncoding(encoding);
  return {line:low,character:normalized==='utf-8' ? Buffer.byteLength(prefix,'utf8') : normalized==='utf-32' ? [...prefix].length : prefix.length};
};

const recognizePositionEncoding = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'utf8' || normalized === 'utf-8') return 'utf-8';
  if (normalized === 'utf32' || normalized === 'utf-32') return 'utf-32';
  if (normalized === 'utf16' || normalized === 'utf-16') return 'utf-16';
  return null;
};

const normalizePositionEncoding = (value) => {
  return recognizePositionEncoding(value) || 'utf-16';
};

const resolveLineWindow = (lineIndex, text, line) => {
  const normalizedText = String(text || '');
  const lineIdx = Math.max(0, Math.floor(Number(line) || 0));
  const start = lineIndex[lineIdx] ?? lineIndex[lineIndex.length - 1] ?? 0;
  const nextLineStart = lineIndex[lineIdx + 1];
  let end = Number.isFinite(nextLineStart)
    ? Math.max(start, Math.min(normalizedText.length, nextLineStart))
    : normalizedText.length;
  // LSP characters are offsets within a line, excluding its terminator.
  if (end > start && normalizedText[end - 1] === '\n') end -= 1;
  if (end > start && normalizedText[end - 1] === '\r') end -= 1;
  return {
    text: normalizedText,
    start,
    end
  };
};

const convertLineCharacterToOffset = ({ text, start, end, character, encoding }) => {
  const targetUnits = Math.max(0, Math.floor(Number(character) || 0));
  if (targetUnits <= 0) return start;
  if (encoding === 'utf-16') {
    return Math.min(end, start + targetUnits);
  }
  let current = start;
  let consumed = 0;
  while (current < end && consumed < targetUnits) {
    const codePoint = text.codePointAt(current);
    if (codePoint == null) break;
    const codeUnitLength = codePoint > 0xFFFF ? 2 : 1;
    const unitWidth = encoding === 'utf-32'
      ? 1
      // Lone surrogates encode as the three-byte replacement character, just
      // like other BMP code points in this branch. No temporary slice needed.
      : (codePoint <= 0x7F ? 1 : codePoint <= 0x7FF ? 2 : codePoint <= 0xFFFF ? 3 : 4);
    if ((consumed + unitWidth) > targetUnits) break;
    consumed += unitWidth;
    current += codeUnitLength;
  }
  return current;
};

/**
 * Convert a 0-based LSP position to a character offset.
 * @param {number[]} lineIndex
 * @param {{line:number,character:number}|null} position
 * @param {{text?:string,positionEncoding?:string}} [options]
 * @returns {number}
 */
export function positionToOffset(lineIndex, position, options = {}) {
  if (!position) return 0;
  const line = Math.max(0, Number(position.line) || 0) + 1;
  const col = Math.max(0, Number(position.character) || 0);
  const positionEncoding = normalizePositionEncoding(options?.positionEncoding);
  if (positionEncoding === 'utf-16') {
    const unclamped = lineColToOffset(lineIndex, line, col);
    if (typeof options?.text !== 'string') {
      return unclamped;
    }
    const lineWindow = resolveLineWindow(lineIndex, options.text, Number(position.line) || 0);
    return Math.max(lineWindow.start, Math.min(lineWindow.end, unclamped));
  }
  const lineWindow = resolveLineWindow(lineIndex, options?.text || '', Number(position.line) || 0);
  return convertLineCharacterToOffset({
    ...lineWindow,
    character: col,
    encoding: positionEncoding
  });
}

/**
 * Convert a 0-based LSP range to start/end offsets.
 * @param {number[]} lineIndex
 * @param {{start:{line:number,character:number},end:{line:number,character:number}}|null} range
 * @param {{text?:string,positionEncoding?:string}} [options]
 * @returns {{start:number,end:number}}
 */
export function rangeToOffsets(lineIndex, range, options = {}) {
  if (!range) return { start: 0, end: 0 };
  return {
    start: positionToOffset(lineIndex, range.start, options),
    end: positionToOffset(lineIndex, range.end, options)
  };
}

export const exactRangeToOffsets = (lineIndex,range,options={}) => {
  const text=options.text;
  if(typeof text !== 'string' || !range)return null;
  for(const key of ['start','end']) if(!Number.isSafeInteger(range[key]?.line) || range[key].line<0
    || range[key].line>=lineIndex.length || !Number.isSafeInteger(range[key]?.character) || range[key].character<0)return null;
  const offsets=rangeToOffsets(lineIndex,range,options);
  if(offsets.end<offsets.start)return null;
  for(const key of ['start','end']) {
    const back=offsetToLspPosition(lineIndex,text,offsets[key],options.positionEncoding);
    if(back.line!==range[key].line || back.character!==range[key].character)return null;
  }
  return offsets;
};

const recognizePositionEncodings = (value) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = recognizePositionEncoding(entry);
      if (normalized) return normalized;
    }
    return null;
  }
  return recognizePositionEncoding(value);
};

export const resolveLspPositionEncoding = (value) => recognizePositionEncodings(value) || 'utf-16';

export const resolveInitializeResultPositionEncoding = (initializeResult) => {
  const capabilities = initializeResult?.capabilities;
  const capabilityPositionEncoding = recognizePositionEncoding(capabilities?.positionEncoding);
  if (capabilityPositionEncoding) return capabilityPositionEncoding;
  const capabilityOffsetEncoding = recognizePositionEncodings(capabilities?.offsetEncoding);
  if (capabilityOffsetEncoding) return capabilityOffsetEncoding;
  const initializePositionEncoding = recognizePositionEncoding(initializeResult?.positionEncoding);
  if (initializePositionEncoding) return initializePositionEncoding;
  return resolveLspPositionEncoding(initializeResult?.offsetEncoding);
};
