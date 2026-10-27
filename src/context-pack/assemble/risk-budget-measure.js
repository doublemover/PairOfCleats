const overflow = Symbol('risk-byte-budget');
const word = /[A-Za-z0-9_./:-]+/g;
const countTokens = (text, limit) => {
  word.lastIndex = 0;
  let count = 0;
  while (word.exec(text)) if (++count > limit) return count;
  return count;
};

/** Compact JSON for owned plain data, admitted before potentially huge strings
 * are encoded. Repeated evidence is charged at every emitted position. */
export const measureRiskBudgetValue = (value, { maxBytes, maxTokens }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 24576
    || !Number.isSafeInteger(maxTokens) || maxTokens < 0 || maxTokens > 2048) throw new TypeError('Invalid risk measurement allowance.');
  const fragments = [], ancestors = new Set();
  let bytes = 0, work = 0;
  const append = text => {
    const size = Buffer.byteLength(text);
    if (bytes + size > maxBytes) throw overflow;
    bytes += size; fragments.push(text);
  };
  const string = text => {
    // JSON UTF-8 cannot be smaller than these UTF-16 code units plus quotes.
    if (text.length + 2 > maxBytes - bytes) throw overflow;
    append(JSON.stringify(text));
  };
  const visit = (entry, depth = 0) => {
    if (++work > 100000 || depth > 64) throw new TypeError('Risk measurement input exceeds bounded plain-data work.');
    if (entry === null || entry === undefined) { append('null'); return; }
    if (typeof entry === 'string') { string(entry); return; }
    if (typeof entry === 'number' || typeof entry === 'boolean') { append(JSON.stringify(entry)); return; }
    if (typeof entry !== 'object') throw new TypeError('Risk measurement requires plain JSON data.');
    const array = Array.isArray(entry), prototype = Object.getPrototypeOf(entry);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new TypeError('Risk measurement requires ordinary objects.');
    if (ancestors.has(entry)) throw new TypeError('Risk measurement cannot encode cyclic data.');
    ancestors.add(entry);
    try {
      append(array ? '[' : '{');
      let emitted = false;
      if (array) {
        for (let index = 0; index < entry.length; index++) {
          if (emitted) append(',');
          const property = Object.getOwnPropertyDescriptor(entry, String(index));
          if (property && !Object.hasOwn(property, 'value')) throw new TypeError('Risk measurement cannot invoke array accessors.');
          visit(property?.value, depth + 1); emitted = true;
        }
      } else {
        for (const key in entry) {
          if (!Object.hasOwn(entry, key)) continue;
          const property = Object.getOwnPropertyDescriptor(entry, key);
          if (!Object.hasOwn(property, 'value')) throw new TypeError('Risk measurement cannot invoke object accessors.');
          if (property.value === undefined) continue;
          if (emitted) append(',');
          string(key); append(':'); visit(property.value, depth + 1); emitted = true;
        }
      }
      append(array ? ']' : '}');
    } finally { ancestors.delete(entry); }
  };
  try { visit(value); }
  catch (error) {
    if (error !== overflow) throw error;
    return { bytes: maxBytes + 1, tokens: null, exactBytes: false, exactTokens: false };
  }
  const text = fragments.join(''), tokens = countTokens(text, maxTokens);
  return { bytes, tokens, exactBytes: true, exactTokens: tokens <= maxTokens };
};
