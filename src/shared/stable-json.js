export function stableStringify(value) {
  return JSON.stringify(normalize(value));
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
