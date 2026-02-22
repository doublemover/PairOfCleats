import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

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
