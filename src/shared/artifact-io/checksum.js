import crypto from 'node:crypto';

const SUPPORTED_ALGOS = new Set(['sha1', 'sha256']);

const normalizeAlgo = (algo) => {
  const value = typeof algo === 'string' ? algo.trim().toLowerCase() : 'sha1';
  if (!SUPPORTED_ALGOS.has(value)) {
    throw new Error(`Unsupported checksum algorithm: ${algo}`);
  }
  return value;
};

const parseChecksumString = (checksum) => {
  if (typeof checksum !== 'string') return null;
  const trimmed = checksum.trim();
  if (!trimmed) return null;
  const index = trimmed.indexOf(':');
  if (index <= 0 || index === trimmed.length - 1) {
    return null;
  }
  return {
    algo: normalizeAlgo(trimmed.slice(0, index)),
    value: trimmed.slice(index + 1).toLowerCase(),
    hash: trimmed.toLowerCase()
  };
};

const resolveExpectedChecksum = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  if (typeof meta.checksum === 'string') {
    const parsed = parseChecksumString(meta.checksum);
    if (!parsed) throw new Error('Invalid packed checksum format');
    return parsed;
  }
  if (meta.checksum && typeof meta.checksum === 'object') {
    const algo = normalizeAlgo(meta.checksum.algo || 'sha1');
    const value = typeof meta.checksum.value === 'string' ? meta.checksum.value.trim().toLowerCase() : '';
    if (!value) throw new Error('Invalid packed checksum value');
    return {
      algo,
      value,
      hash: `${algo}:${value}`
    };
  }
  return null;
};

export const computePackedChecksum = (buffer, { algo = 'sha1' } = {}) => {
  const resolvedAlgo = normalizeAlgo(algo);
  const hash = crypto.createHash(resolvedAlgo);
  hash.update(buffer);
  const value = hash.digest('hex');
  return {
    algo: resolvedAlgo,
    value,
    hash: `${resolvedAlgo}:${value}`
  };
};

export const createPackedChecksumValidator = (
  meta,
  { label = 'packed artifact' } = {}
) => {
  const expected = resolveExpectedChecksum(meta);
  if (!expected) return null;
  const hash = crypto.createHash(expected.algo);
  return {
    update(buffer, start = 0, end = null) {
      if (!buffer) return;
      if (end == null) {
        hash.update(buffer);
        return;
      }
      hash.update(buffer.subarray(start, end));
    },
    verify() {
      const actualValue = hash.digest('hex');
      if (actualValue !== expected.value) {
        throw new Error(
          `${label} checksum mismatch (${expected.algo}:${actualValue} !== ${expected.hash})`
        );
      }
      return expected.hash;
    }
  };
};
