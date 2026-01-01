import { lineColToOffset } from '../../shared/lines.js';

/**
 * Convert a 0-based LSP position to a character offset.
 * @param {number[]} lineIndex
 * @param {{line:number,character:number}|null} position
 * @returns {number}
 */
export function positionToOffset(lineIndex, position) {
  if (!position) return 0;
  const line = Number(position.line) + 1;
  const col = Number(position.character) || 0;
  return lineColToOffset(lineIndex, line, col);
}

/**
 * Convert a 0-based LSP range to start/end offsets.
 * @param {number[]} lineIndex
 * @param {{start:{line:number,character:number},end:{line:number,character:number}}|null} range
 * @returns {{start:number,end:number}}
 */
export function rangeToOffsets(lineIndex, range) {
  if (!range) return { start: 0, end: 0 };
  return {
    start: positionToOffset(lineIndex, range.start),
    end: positionToOffset(lineIndex, range.end)
  };
}
