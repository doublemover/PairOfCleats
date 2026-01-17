import crypto from 'node:crypto';
import fs from 'node:fs';
import { getEnvConfig } from './env.js';
import { hash64Stream, hashFileStream, resolveXxhashBackend } from './hash/xxhash-backend.js';

let backendOverride = null;
let backendName = null;
let backendPromise = null;
let backendLogKey = null;

const resolveBackendName = (envConfig) => {
  if (backendOverride) return backendOverride;
  const envValue = envConfig?.xxhashBackend;
  if (typeof envValue === 'string' && envValue.trim()) return envValue.trim();
  return 'auto';
};

const logBackendChoice = (backend, requested, envConfig) => {
  if (envConfig?.verbose !== true) return;
  const backendLabel = backend?.name || 'unknown';
  const requestedLabel = requested || 'auto';
  const nextKey = `${requestedLabel}:${backendLabel}`;
  if (backendLogKey === nextKey) return;
  backendLogKey = nextKey;
  console.warn(`[hash] xxhash backend: ${backendLabel} (requested: ${requestedLabel})`);
};

const getBackend = async () => {
  const envConfig = getEnvConfig();
  const next = resolveBackendName(envConfig);
  if (backendPromise && backendName === next) return backendPromise;
  backendName = next;
  backendPromise = resolveXxhashBackend({
    backend: next,
    verbose: envConfig.verbose === true
  }).then((backend) => {
    logBackendChoice(backend, next, envConfig);
    return backend;
  });
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
  const backend = await getBackend();
  const value = await backend.hash64(input);
  return { algo: 'xxh64', value };
}

export async function checksumFile(filePath) {
  const backend = await getBackend();
  const stream = hashFileStream(filePath);
  const value = await hash64Stream(stream, backend);
  return { algo: 'xxh64', value };
}

export function setXxhashBackend(backend) {
  backendOverride = typeof backend === 'string' && backend.trim() ? backend.trim() : null;
  backendName = null;
  backendPromise = null;
  backendLogKey = null;
}
