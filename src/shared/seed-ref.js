import { normalizeRepoRelativePath } from './path-normalize.js';

/**
 * Seed reference regex (type:suffix).
 */
const SEED_REGEX = /^(chunk|symbol|file):(.+)$/;

/**
 * Parse a seed reference string.
 *
 * Path handling: file seeds must resolve to repo-relative paths.
 *
 * @param {string} raw
 * @param {string} repoRoot
 * @returns {{ type: 'chunk', chunkUid: string } | { type: 'symbol', symbolId: string } | { type: 'file', path: string }}
 * @throws {Error} on invalid seed format
 */
export const parseSeedRef = (raw, repoRoot) => {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Missing --seed value.');
  const match = SEED_REGEX.exec(value);
  if (!match) {
    throw new Error('Invalid --seed value. Use chunk:<id>, symbol:<id>, or file:<path>.');
  }
  const type = match[1];
  const suffix = match[2].trim();
  if (!suffix) throw new Error('Invalid --seed value.');
  if (type === 'chunk') return { type: 'chunk', chunkUid: suffix };
  if (type === 'symbol') return { type: 'symbol', symbolId: suffix };
  if (type === 'file') {
    const rel = normalizeRepoRelativePath(suffix, repoRoot);
    if (!rel) {
      throw new Error('file: seeds must resolve to a repo-relative path.');
    }
    return { type: 'file', path: rel };
  }
  throw new Error('Unsupported --seed type.');
};
