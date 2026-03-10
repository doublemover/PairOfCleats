import { lineColToOffset } from '../../../shared/lines.js';

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
  const end = Number.isFinite(nextLineStart)
    ? Math.max(start, Math.min(normalizedText.length, nextLineStart))
    : normalizedText.length;
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
    const slice = text.slice(current, current + codeUnitLength);
    const unitWidth = encoding === 'utf-32'
      ? 1
      : Buffer.byteLength(slice, 'utf8');
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

export const resolveLspPositionEncoding = (value) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = recognizePositionEncoding(entry);
      if (normalized) return normalized;
    }
    return 'utf-16';
  }
  return normalizePositionEncoding(value);
};

export const resolveInitializeResultPositionEncoding = (initializeResult) => {
  const capabilities = initializeResult?.capabilities;
  const capabilityPositionEncoding = recognizePositionEncoding(capabilities?.positionEncoding);
  if (capabilityPositionEncoding) return capabilityPositionEncoding;
  const capabilityOffsetEncoding = resolveLspPositionEncoding(capabilities?.offsetEncoding);
  if (capabilityOffsetEncoding) return capabilityOffsetEncoding;
  const initializePositionEncoding = recognizePositionEncoding(initializeResult?.positionEncoding);
  if (initializePositionEncoding) return initializePositionEncoding;
  return resolveLspPositionEncoding(initializeResult?.offsetEncoding);
};
