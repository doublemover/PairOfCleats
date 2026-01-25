export function stableStringify(value) {
  return JSON.stringify(normalize(value));
}

export function stableStringifyForSignature(value) {
  return JSON.stringify(canonicalizeForSignature(value));
}

export function canonicalizeForSignature(value) {
  return normalizeSignature(value);
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry));
  }
  if (!value || typeof value !== 'object' || value.constructor !== Object) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalize(value[key]);
  }
  return out;
}

function normalizeSignature(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') {
      return { __type: 'bigint', value: value.toString() };
    }
    return value;
  }
  if (value instanceof RegExp) {
    return { __type: 'regexp', source: value.source, flags: value.flags };
  }
  if (value instanceof Set) {
    const values = Array.from(value).map((entry) => normalizeSignature(entry));
    values.sort(sortBySignature);
    return { __type: 'set', values };
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([key, entry]) => ([
      normalizeSignature(key),
      normalizeSignature(entry)
    ]));
    entries.sort((a, b) => sortBySignature(a[0], b[0]));
    return { __type: 'map', entries };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSignature(entry));
  }
  if (!value || value.constructor !== Object) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = normalizeSignature(value[key]);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function sortBySignature(a, b) {
  const aKey = stableStringifyForSignature(a);
  const bKey = stableStringifyForSignature(b);
  return aKey < bKey ? -1 : (aKey > bKey ? 1 : 0);
}
