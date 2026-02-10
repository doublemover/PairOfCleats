import { ANN_PROVIDER_IDS } from './types.js';

export const ANN_BACKEND_CHOICES = Object.freeze([
  'auto',
  ANN_PROVIDER_IDS.LANCEDB,
  ANN_PROVIDER_IDS.SQLITE_VECTOR,
  ANN_PROVIDER_IDS.HNSW,
  ANN_PROVIDER_IDS.DENSE
]);

const ANN_BACKEND_ALIASES = new Map([
  ['auto', 'auto'],
  ['lancedb', ANN_PROVIDER_IDS.LANCEDB],
  ['sqlite', ANN_PROVIDER_IDS.SQLITE_VECTOR],
  ['sqlite-extension', ANN_PROVIDER_IDS.SQLITE_VECTOR],
  ['vector-extension', ANN_PROVIDER_IDS.SQLITE_VECTOR],
  ['sqlite-vector', ANN_PROVIDER_IDS.SQLITE_VECTOR],
  ['hnsw', ANN_PROVIDER_IDS.HNSW],
  ['dense', ANN_PROVIDER_IDS.DENSE],
  ['js', ANN_PROVIDER_IDS.DENSE]
]);

export const normalizeAnnBackend = (
  value,
  {
    defaultBackend = ANN_PROVIDER_IDS.LANCEDB,
    allowAuto = true,
    strict = false
  } = {}
) => {
  if (typeof value !== 'string') {
    return strict ? null : defaultBackend;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return strict ? null : defaultBackend;
  }
  const mapped = ANN_BACKEND_ALIASES.get(trimmed) || null;
  if (!mapped) {
    return strict ? null : defaultBackend;
  }
  if (mapped === 'auto' && !allowAuto) {
    return strict ? null : defaultBackend;
  }
  return mapped;
};

export const resolveAnnOrder = (value) => {
  switch (normalizeAnnBackend(value, { defaultBackend: 'auto' })) {
    case ANN_PROVIDER_IDS.LANCEDB:
      return [
        ANN_PROVIDER_IDS.LANCEDB,
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.DENSE
      ];
    case ANN_PROVIDER_IDS.SQLITE_VECTOR:
      return [
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.LANCEDB,
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.DENSE
      ];
    case ANN_PROVIDER_IDS.HNSW:
      return [
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.LANCEDB,
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.DENSE
      ];
    case ANN_PROVIDER_IDS.DENSE:
      return [ANN_PROVIDER_IDS.DENSE];
    case 'auto':
    default:
      return [
        ANN_PROVIDER_IDS.LANCEDB,
        ANN_PROVIDER_IDS.SQLITE_VECTOR,
        ANN_PROVIDER_IDS.HNSW,
        ANN_PROVIDER_IDS.DENSE
      ];
  }
};
