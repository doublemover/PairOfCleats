const width = code => code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
const units = code => code > 0xffff ? 2 : 1;
const invalid = () => { throw new RangeError('Python AST column is outside the line or splits a UTF-8 code point.'); };

/** CPython byte columns map to UTF-16 through source-owned line checkpoints.
 * Keep a pair only after at least 256 bytes, never one cell per input byte. */
export const createPythonByteColumnResolver = (text, lineIndex) => {
  const lines = new Map();
  return (line, column = 0) => {
    if (!Number.isSafeInteger(line) || line < 1 || line > lineIndex.length
      || !Number.isSafeInteger(column) || column < 0) throw new RangeError('Invalid Python AST source coordinate.');
    let info = lines.get(line);
    if (!info) {
      const start = lineIndex[line - 1];
      let end = line < lineIndex.length ? lineIndex[line] - 1 : text.length;
      if (end > start && text[end - 1] === '\r') end--;
      const byteLength = Buffer.byteLength(text.slice(start, end), 'utf8');
      info = { start, end, byteLength, bytePoints: null, unitPoints: null };
      if (byteLength !== end - start) {
        const bytePoints = [0], unitPoints = [0];
        let bytes = 0;
        for (let index = start; index < end;) {
          const code = text.codePointAt(index);
          bytes += width(code); index += units(code);
          if (bytes - bytePoints[bytePoints.length - 1] >= 256) {
            bytePoints.push(bytes); unitPoints.push(index - start);
          }
        }
        info.bytePoints = Uint32Array.from(bytePoints);
        info.unitPoints = Uint32Array.from(unitPoints);
      }
      lines.set(line, info);
    }
    if (column > info.byteLength) invalid();
    if (!info.bytePoints) return info.start + column;
    let low = 0, high = info.bytePoints.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (info.bytePoints[middle] <= column) low = middle;
      else high = middle;
    }
    let bytes = info.bytePoints[low], index = info.start + info.unitPoints[low];
    while (bytes < column && index < info.end) {
      const code = text.codePointAt(index);
      bytes += width(code); index += units(code);
    }
    if (bytes !== column) invalid();
    return index;
  };
};
