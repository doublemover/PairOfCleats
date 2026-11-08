/** Astro positions are UTF-8 bytes; downstream source spans are UTF-16 units.
 * Sparse checkpoints bound conversion work without allocating per input byte. */
export const createAstroOffsetResolver = (text) => {
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength === text.length) {
    return offset => Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length ? offset : null;
  }
  const bytePoints = [0], unitPoints = [0];
  let bytes = 0;
  for (let index = 0; index < text.length;) {
    const code = text.codePointAt(index);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    index += code > 0xffff ? 2 : 1;
    if (bytes - bytePoints[bytePoints.length - 1] >= 256) {
      bytePoints.push(bytes); unitPoints.push(index);
    }
  }
  return offset => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > byteLength) return null;
    let low = 0, high = bytePoints.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (bytePoints[middle] <= offset) low = middle;
      else high = middle;
    }
    let bytes = bytePoints[low], index = unitPoints[low];
    while (bytes < offset) {
      const code = text.codePointAt(index);
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      index += code > 0xffff ? 2 : 1;
    }
    return bytes === offset ? index : null;
  };
};
