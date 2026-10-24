const budgetError = () => Object.assign(new RangeError('Canonical semantic JSON exceeds its byte allowance.'), {
  code: 'ERR_SEMANTIC_JSON_BUDGET'
});

/** Canonical JSON's admitted representation, encoded without recursive descent.
 * Charge strings and container metadata before allocating their encoded forms.
 * This bounds our output/snapshot work, not memory already owned by a caller.
 */
export const encodeBoundedSemanticJson = (value, { maxBytes, onObjectEncoded, check }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('A positive canonical JSON byte allowance is required.');
  const chunks = [], active = new Set(), pending = [{ kind: 'value', value }];
  let bytes = 0;
  const charge = count => {
    if (count > maxBytes - bytes) throw budgetError();
    bytes += count;
  };
  const quotedBytes = text => {
    // Every UTF16 unit requires at least one JSON UTF8 byte. Reject enormous
    // leaves before scanning or asking JSON.stringify to allocate an escape copy.
    if (text.length + 2 > maxBytes - bytes) throw budgetError();
    let size = 2;
    for (let index = 0; index < text.length; index++) {
      if (index % 4096 === 0) check?.();
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) size += 2;
      else if (code < 32) size += 6;
      else if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { size += 4; index++; }
        else size += 6;
      } else size += code >= 0xdc00 && code <= 0xdfff ? 6 : 3;
      if (size > maxBytes - bytes) throw budgetError();
    }
    return size;
  };
  while (pending.length) {
    check?.();
    const task = pending.pop();
    if (task.kind === 'container') {
      const { item, array, keys, start, length } = task;
      if (task.index === length) {
        chunks.push(array ? ']' : '}');
        active.delete(item);
        onObjectEncoded?.(item, chunks.slice(start).join(''));
        continue;
      }
      const index = task.index++, key = array ? String(index) : keys[index];
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Identity getters are not JSON.');
      if (index) chunks.push(',');
      if (!array) chunks.push(JSON.stringify(key), ':');
      pending.push(task, { kind: 'value', value: descriptor.value });
      continue;
    }
    const item = task.value;
    if (item === null || typeof item === 'boolean') {
      const encoded = item === null ? 'null' : item ? 'true' : 'false';
      charge(encoded.length); chunks.push(encoded); continue;
    }
    if (typeof item === 'string') { charge(quotedBytes(item)); chunks.push(JSON.stringify(item)); continue; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) throw new TypeError('Semantic identity numbers must be finite and must not be negative zero.');
      const encoded = JSON.stringify(item); charge(encoded.length); chunks.push(encoded); continue;
    }
    if (typeof item !== 'object') throw new TypeError('Semantic identities require explicit JSON values.');
    if (active.has(item)) throw new TypeError('Semantic identities cannot contain cycles.');
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype
      && Object.getPrototypeOf(item) !== null) throw new TypeError('Expected a plain JSON object.');
    // A dense array needs at least one byte per value plus its separators.
    // Inspect its finite length before enumerating any caller-owned properties.
    const length = array ? item.length : null;
    if (array && length && length > Math.floor((maxBytes - bytes - 1) / 2)) throw budgetError();
    charge(2);
    const keys = [];
    let count = 0;
    for (const key in item) {
      check?.();
      if (!Object.hasOwn(item, key)) continue;
      if (array) {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
          throw new TypeError('Sparse or decorated arrays are not JSON.');
        }
      } else {
        charge(quotedBytes(key) + 1 + (count ? 1 : 0));
        keys.push(key);
      }
      count++;
    }
    if (array) {
      if (count !== length) throw new TypeError('Sparse or decorated arrays are not JSON.');
      charge(Math.max(0, length - 1));
    }
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Symbol keys are not JSON.');
    if (!array) keys.sort();
    const start = chunks.length;
    chunks.push(array ? '[' : '{');
    active.add(item);
    pending.push({ kind: 'container', item, array, keys, length: array ? length : keys.length, index: 0, start });
  }
  return chunks.join('');
};
