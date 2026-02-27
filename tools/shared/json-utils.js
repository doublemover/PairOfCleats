import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

/**
 * Read JSON from disk and return a fallback on missing/invalid files.
 * @param {string} filePath
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
export function readJsonFileSyncSafe(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Read JSON from disk and return a fallback on missing/invalid files.
 * @param {string} filePath
 * @param {unknown} [fallback]
 * @returns {Promise<unknown>}
 */
export async function readJsonFileSafe(filePath, fallback = null) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Read JSON from a resolved absolute path and throw on read/parse failures.
 * @param {string} filePath
 * @returns {Promise<unknown>}
 */
export async function readJsonFileResolved(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const raw = await fsPromises.readFile(resolved, 'utf8');
  return JSON.parse(raw);
}

/**
 * Read JSON from a resolved absolute path and return fallback on
 * missing/invalid files.
 * @param {string} filePath
 * @param {unknown} [fallback]
 * @returns {Promise<unknown>}
 */
export async function readJsonFileResolvedSafe(filePath, fallback = null) {
  if (!filePath) return fallback;
  return readJsonFileSafe(path.resolve(filePath), fallback);
}

/**
 * Write formatted JSON to disk.
 * @param {string} filePath
 * @param {unknown} payload
 * @param {{trailingNewline?:boolean}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonFile(filePath, payload, options = {}) {
  const trailingNewline = options.trailingNewline === true;
  await fsPromises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}${trailingNewline ? '\n' : ''}`);
}

/**
 * Write formatted JSON to an absolute path, ensuring parent directory exists.
 * Returns the resolved path when written, otherwise null for empty targets.
 *
 * @param {string} filePath
 * @param {unknown} payload
 * @param {{trailingNewline?:boolean,ensureDir?:boolean}} [options]
 * @returns {Promise<string|null>}
 */
export async function writeJsonFileResolved(filePath, payload, options = {}) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (options.ensureDir !== false) {
    await fsPromises.mkdir(path.dirname(resolved), { recursive: true });
  }
  await writeJsonFile(resolved, payload, options);
  return resolved;
}
