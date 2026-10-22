import crypto from 'node:crypto';
import fs from 'node:fs';

let backendOverride = null;
let backendName = null;
let backendPromise = null;
const resolveBackendName = () => {
  if (backendOverride) return backendOverride;
  return 'auto';
};

const getBackend = async () => {
  const next = resolveBackendName();
  if (backendPromise && backendName === next) return backendPromise;
  backendName = next;
  backendPromise = import('./hash/xxhash-backend.js').then(({ resolveXxhashBackend }) =>
    resolveXxhashBackend({ backend: next, verbose: false }));
  return backendPromise;
};

/**
 * Compute a SHA1 hash hex string.
 * @param {string} str
 * @returns {string}
 */
export function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

const withFileHashStream = async (filePath, compute) => {
  const stream = fs.createReadStream(filePath);
  const closed = new Promise(resolve => stream.once('close', resolve));
  try {
    return await compute(stream);
  } finally {
    stream.destroy();
    await closed;
  }
};

/**
 * Compute a SHA1 hash for a file on disk.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function sha1File(filePath) {
  return withFileHashStream(filePath, stream => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  }));
}

export async function checksumString(input) {
  const backend = await getBackend();
  const value = await backend.hash64(input);
  return { algo: 'xxh64', value };
}

export async function checksumFile(filePath) {
  const { hash64Stream } = await import('./hash/xxhash-backend.js');
  const backend = await getBackend();
  const value = await withFileHashStream(filePath, stream => hash64Stream(stream, backend));
  return { algo: 'xxh64', value };
}

export async function getXxhashBackend() {
  try {
    const backend = await getBackend();
    return backend?.name || null;
  } catch {
    return null;
  }
}

export function setXxhashBackend(backend) {
  backendOverride = typeof backend === 'string' && backend.trim() ? backend.trim() : null;
  backendName = null;
  backendPromise = null;
}
