/** Exact JSON UTF-8 admission for schema-owned plain values without constructing
 * the encoded response or a second copy of a concrete witness string.
 */
export const measureSymbolicResponseBytes = (value, maxBytes) => {
  const fail = () => { throw Object.assign(new Error('Symbolic type response exceeds output budget.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' }); };
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail();
  let bytes = 0;
  const charge = count => { bytes += count; if (bytes > maxBytes) fail(); };
  const stack = [value];
  while (stack.length) {
    const entry = stack.pop();
    if (typeof entry === 'string') {
      charge(2);
      for (let index = 0; index < entry.length; index += 1) {
        const code = entry.charCodeAt(index);
        if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) charge(2);
        else if (code < 32) charge(6);
        else if (code < 128) charge(1);
        else if (code < 2048) charge(2);
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < entry.length
          && entry.charCodeAt(index + 1) >= 0xdc00 && entry.charCodeAt(index + 1) <= 0xdfff) {
          charge(4); index += 1;
        } else if (code >= 0xd800 && code <= 0xdfff) charge(6);
        else charge(3);
      }
    } else if (entry === null || entry === undefined) charge(4);
    else if (typeof entry === 'boolean') charge(entry ? 4 : 5);
    else if (typeof entry === 'number') charge(Number.isFinite(entry) ? String(entry).length : 4);
    else if (Array.isArray(entry)) {
      charge(2 + Math.max(0, entry.length - 1));
      if (entry.length > maxBytes - bytes + 1) fail();
      for (const item of entry) stack.push(item);
    } else if (typeof entry === 'object') {
      const keys = Object.keys(entry).filter(key => entry[key] !== undefined);
      charge(2 + Math.max(0, keys.length - 1) + keys.length);
      if (keys.length * 3 > maxBytes - bytes) fail();
      for (const key of keys) { stack.push(key, entry[key]); }
    } else throw new TypeError('Unsupported symbolic response value.');
  }
  return bytes;
};
