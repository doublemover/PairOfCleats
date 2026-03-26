const BYTES_PER_MB = 1024 * 1024;

export const DEFAULT_CACHE_MB = {
  fileText: 64,
  summary: 32,
  formatFull: 16,
  formatShort: 16,
  lint: 16,
  complexity: 16,
  gitMeta: 32
};

export const DEFAULT_CACHE_TTL_MS = {
  fileText: 0,
  summary: 0,
  formatFull: 0,
  formatShort: 0,
  lint: 0,
  complexity: 0,
  gitMeta: 5 * 60 * 1000
};

export const mbToBytes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed * BYTES_PER_MB));
};

export const estimateStringBytes = (value) => {
  if (typeof value !== 'string') return 0;
  const size = Buffer.byteLength(value, 'utf8');
  return size > 0 ? size : 1;
};

export const estimateJsonBytes = (value) => {
  const MAX_DEPTH = 4;
  const MAX_SAMPLE = 200;
  const seen = new WeakSet();
  const estimateValue = (entry, depth) => {
    if (entry == null) return 4;
    const type = typeof entry;
    if (type === 'string') return Buffer.byteLength(entry, 'utf8');
    if (type === 'number' || type === 'boolean') return 8;
    if (type !== 'object') return 0;
    if (seen.has(entry)) return 0;
    seen.add(entry);
    if (depth >= MAX_DEPTH) return 8;
    if (Array.isArray(entry)) {
      const len = entry.length;
      const sampleCount = Math.min(len, MAX_SAMPLE);
      let sum = 2;
      for (let i = 0; i < sampleCount; i += 1) {
        sum += estimateValue(entry[i], depth + 1) + 1;
      }
      if (sampleCount && len > sampleCount) {
        sum = Math.round(sum * (len / sampleCount));
      }
      return sum;
    }
    const keys = Object.keys(entry);
    const sampleCount = Math.min(keys.length, MAX_SAMPLE);
    let sum = 2;
    for (let i = 0; i < sampleCount; i += 1) {
      const key = keys[i];
      sum += Buffer.byteLength(key, 'utf8') + 4;
      sum += estimateValue(entry[key], depth + 1) + 1;
    }
    if (sampleCount && keys.length > sampleCount) {
      sum = Math.round(sum * (keys.length / sampleCount));
    }
    return sum;
  };
  try {
    return estimateValue(value, 0);
  } catch {
    return 0;
  }
};

export const estimateFileTextBytes = (value) => {
  if (value == null) return 0;
  let size = 0;
  if (typeof value === 'string') size = estimateStringBytes(value);
  else if (Buffer.isBuffer(value)) size = value.length;
  else if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value.buffer)) size = value.buffer.length;
    else if (Buffer.isBuffer(value.data)) size = value.data.length;
    else if (typeof value.text === 'string') size = estimateStringBytes(value.text);
  }
  if (!Number.isFinite(size) || size <= 0) {
    size = estimateJsonBytes(value);
  }
  return Number.isFinite(size) && size > 0 ? size : 1;
};

export { BYTES_PER_MB };
