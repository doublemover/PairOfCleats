export const defaultNormalize = (value) => String(value || '').toLowerCase();

export const normalizeList = (value) => {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .flatMap((entry) => String(entry || '').split(/[,\s]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const normalizePhraseList = (value) => {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  const out = [];
  for (const entry of entries) {
    const raw = String(entry || '').trim();
    if (!raw) continue;
    if (raw.includes(',')) {
      raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => out.push(part));
    } else {
      out.push(raw);
    }
  }
  return out;
};

export const matchList = (list, value, normalize = defaultNormalize) => {
  if (!value) return true;
  if (!Array.isArray(list)) return false;
  const needle = normalize(value);
  return list.some((entry) => normalize(entry).includes(needle));
};

export const matchAny = (list, value, normalize = defaultNormalize) => {
  if (!value) return true;
  if (!Array.isArray(list)) return false;
  const needles = Array.isArray(value) ? value : [value];
  return needles.some((needle) => list.some((entry) => normalize(entry).includes(normalize(needle))));
};

export const truthy = (value) => value === true;
