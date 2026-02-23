const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * Create normalized file version signature tuple.
 *
 * @param {{size?:number,mtimeMs?:number,hash?:string}} input
 * @returns {{size:number|null,mtimeMs:number|null,hash:string|null}}
 */
export const createTreeSitterFileVersionSignature = ({ size, mtimeMs, hash }) => ({
  size: toFiniteNumber(size),
  mtimeMs: toFiniteNumber(mtimeMs),
  hash: toNonEmptyString(hash)
});

/**
 * Normalize arbitrary value into file-version signature shape.
 *
 * @param {unknown} value
 * @returns {{size:number|null,mtimeMs:number|null,hash:string|null}|null}
 */
export const normalizeTreeSitterFileVersionSignature = (value) => {
  if (!value || typeof value !== 'object') return null;
  return createTreeSitterFileVersionSignature({
    size: value.size,
    mtimeMs: value.mtimeMs,
    hash: value.hash
  });
};

/**
 * Compare normalized file-version signatures for exact equality.
 *
 * @param {{size:number|null,mtimeMs:number|null,hash:string|null}|null} a
 * @param {{size:number|null,mtimeMs:number|null,hash:string|null}|null} b
 * @returns {boolean}
 */
export const treeSitterFileVersionSignaturesEqual = (a, b) => {
  if (!a || !b) return false;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.hash === b.hash;
};

/**
 * Render file-version signature as compact diagnostic string.
 *
 * @param {{size?:number,mtimeMs?:number,hash?:string}|null} signature
 * @returns {string}
 */
export const formatTreeSitterFileVersionSignature = (signature) => {
  if (!signature || typeof signature !== 'object') return 'unknown';
  const size = Number.isFinite(signature.size) ? signature.size : 'null';
  const mtimeMs = Number.isFinite(signature.mtimeMs) ? signature.mtimeMs : 'null';
  const hash = typeof signature.hash === 'string' && signature.hash ? signature.hash : 'null';
  return `size=${size},mtimeMs=${mtimeMs},hash=${hash}`;
};
