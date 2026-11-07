const isHighSurrogate = code => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = code => code >= 0xdc00 && code <= 0xdfff;

/** Keep UTF-16 source offsets at a scalar boundary. A scalar wider than a
 * target is admitted whole; malformed input retains its original code units. */
export const unicodeScalarBoundary = (text, start, next, end = text.length) => {
  let boundary = Math.min(next, end);
  if (boundary > start && boundary < end && isHighSurrogate(text.charCodeAt(boundary - 1))
    && isLowSurrogate(text.charCodeAt(boundary))) boundary--;
  if (boundary <= start) boundary = Math.min(end,
    start + (isHighSurrogate(text.charCodeAt(start)) && isLowSurrogate(text.charCodeAt(start + 1)) ? 2 : 1));
  return boundary;
};

/** Split UTF-16 text without separating a valid Unicode surrogate pair. */
export const splitUnicodeChunks = (text, maxCodeUnits) => {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 2) {
    throw new RangeError('Unicode chunk size must be a safe integer of at least two code units.');
  }
  const chunks = [];
  for (let offset = 0; offset < text.length;) {
    const end = unicodeScalarBoundary(text, offset, offset + maxCodeUnits);
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
};
