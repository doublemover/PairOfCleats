import crypto from 'node:crypto';
import fs from 'node:fs';
import xxhash from 'xxhash-wasm';

const XXHASH_HEX_WIDTH = 16;
let xxhashState = null;

const loadXxhash = async () => {
  if (!xxhashState) {
    xxhashState = xxhash();
  }
  return xxhashState;
};

const formatXxhashHex = (value) => {
  if (typeof value === 'bigint') {
    return value.toString(16).padStart(XXHASH_HEX_WIDTH, '0');
  }
  if (typeof value === 'number') {
    return Math.floor(value).toString(16).padStart(XXHASH_HEX_WIDTH, '0');
  }
  if (typeof value === 'string') return value;
  return '';
};

/**
 * Compute a SHA1 hash hex string.
 * @param {string} str
 * @returns {string}
 */
export function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

/**
 * Compute a SHA1 hash for a file on disk.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function checksumString(input) {
  const { h64ToString } = await loadXxhash();
  return { algo: 'xxh64', value: h64ToString(input) };
}

export async function checksumFile(filePath) {
  const { create64 } = await loadXxhash();
  return new Promise((resolve, reject) => {
    const hasher = create64();
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hasher.update(chunk));
    stream.on('end', () => resolve({ algo: 'xxh64', value: formatXxhashHex(hasher.digest()) }));
  });
}
