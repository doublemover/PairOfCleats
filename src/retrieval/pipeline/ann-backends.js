import { ANN_PROVIDER_IDS } from '../ann/types.js';

export const normalizeAnnBackend = (value) => {
  if (typeof value !== 'string') return ANN_PROVIDER_IDS.LANCEDB;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return ANN_PROVIDER_IDS.LANCEDB;
  if (trimmed === 'sqlite' || trimmed === 'sqlite-extension') {
    return ANN_PROVIDER_IDS.SQLITE_VECTOR;
  }
  if (trimmed === 'dense') return ANN_PROVIDER_IDS.DENSE;
  return trimmed;
};

export const resolveAnnOrder = (value) => {
  switch (normalizeAnnBackend(value)) {
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
