import { normalizeRepoRelativePath } from './path-normalize.js';

const SEED_REGEX = /^(chunk|symbol|file):(.+)$/;

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
