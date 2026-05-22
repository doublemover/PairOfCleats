import { sortStrings } from './path-utils.js';

const toPositiveIntegerOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
};

export const toNonNegativeIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
};

export const toNonNegativeInt = (value) => toNonNegativeIntOrNull(value) ?? 0;

export const toNonNegativeMsOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Number(numeric.toFixed(3));
};

export const toNonNegativeMs = (value) => toNonNegativeMsOrNull(value) ?? 0;

export const bumpCount = (target, key, amount = 1) => {
  if (!target || typeof target !== 'object') return;
  if (!key) return;
  const current = Number(target[key]) || 0;
  target[key] = current + Math.max(0, Math.floor(Number(amount) || 0));
};

export const toPositiveCountMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output = Object.create(null);
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string' || !key) continue;
    const count = toNonNegativeIntOrNull(raw);
    if (count == null || count <= 0) continue;
    output[key] = count;
  }
  return output;
};

export const toSortedCountObject = (counts, { nullPrototype = true } = {}) => {
  const entries = Object.entries(
    counts && typeof counts === 'object' && !Array.isArray(counts) ? counts : {}
  )
    .map(([key, value]) => [key, toPositiveIntegerOrNull(value)])
    .filter(([key, value]) => key && value != null)
    .sort((a, b) => sortStrings(a[0], b[0]));
  const output = nullPrototype ? Object.create(null) : {};
  for (const [key, value] of entries) {
    output[key] = value;
  }
  return output;
};

export const toSortedHotspotEntries = (counts, { maxEntries = 20 } = {}) => (
  Object.entries(counts && typeof counts === 'object' && !Array.isArray(counts) ? counts : {})
    .map(([importer, value]) => [importer, toPositiveIntegerOrNull(value)])
    .filter(([importer, value]) => importer && value != null)
    .map(([importer, count]) => ({ importer, count }))
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.importer, b.importer)
    ))
    .slice(0, Math.max(0, Math.floor(Number(maxEntries) || 0)))
);
