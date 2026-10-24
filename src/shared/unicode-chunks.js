/** Split UTF-16 text without separating a valid Unicode surrogate pair. */
export const splitUnicodeChunks = (text, maxCodeUnits) => {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 2) {
    throw new RangeError('Unicode chunk size must be a safe integer of at least two code units.');
  }
  const chunks = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + maxCodeUnits);
    if (end < text.length) {
      const before = text.charCodeAt(end - 1), after = text.charCodeAt(end);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
};
