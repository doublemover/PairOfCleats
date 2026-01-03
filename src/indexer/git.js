import path from 'node:path';
import simpleGit from 'simple-git';
import {
  createLruCache,
  DEFAULT_CACHE_MB,
  DEFAULT_CACHE_TTL_MS,
  estimateJsonBytes
} from '../shared/cache.js';

let gitMetaCache = createLruCache({
  name: 'gitMeta',
  maxMb: DEFAULT_CACHE_MB.gitMeta,
  ttlMs: DEFAULT_CACHE_TTL_MS.gitMeta,
  sizeCalculation: estimateJsonBytes
});

let gitBlameCache = createLruCache({
  name: 'gitBlame',
  maxMb: DEFAULT_CACHE_MB.gitMeta,
  ttlMs: DEFAULT_CACHE_TTL_MS.gitMeta,
  sizeCalculation: estimateJsonBytes
});

/**
 * Configure git metadata cache settings.
 * @param {{maxMb?:number,ttlMs?:number}|null} cacheConfig
 * @param {{track?:(stats:object)=>void}|null} reporter
 */
export function configureGitMetaCache(cacheConfig, reporter = null) {
  const maxMb = Number.isFinite(Number(cacheConfig?.maxMb))
    ? Number(cacheConfig.maxMb)
    : DEFAULT_CACHE_MB.gitMeta;
  const ttlMs = Number.isFinite(Number(cacheConfig?.ttlMs))
    ? Number(cacheConfig.ttlMs)
    : DEFAULT_CACHE_TTL_MS.gitMeta;
  gitMetaCache = createLruCache({
    name: 'gitMeta',
    maxMb,
    ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter
  });
  gitBlameCache = createLruCache({
    name: 'gitBlame',
    maxMb,
    ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter
  });
}

/**
 * Fetch git metadata for an entire file, with optional line-level blame.
 * Returns empty object when git is unavailable or fails.
 * @param {string} file
 * @param {{blame?:boolean,baseDir?:string}} [options]
 * @returns {Promise<{last_modified?:string,last_author?:string,churn?:number,churn_added?:number,churn_deleted?:number,churn_commits?:number,lineAuthors?:string[]}|{}>}
 */
export async function getGitMetaForFile(file, options = {}) {
  const blameEnabled = options.blame !== false;
  const baseDir = options.baseDir
    ? path.resolve(options.baseDir)
    : (path.isAbsolute(file) ? path.dirname(file) : process.cwd());
  const relFile = path.isAbsolute(file) ? path.relative(baseDir, file) : file;
  const fileArg = relFile.split(path.sep).join('/');
  const cacheKey = `${baseDir}::${fileArg}`;

  const cached = gitMetaCache.get(cacheKey);
  if (cached && !blameEnabled) return cached;

  try {
    const git = simpleGit({ baseDir });
    let meta = cached;
    if (!meta) {
      const log = await git.log({ file: fileArg, n: 10 });
      const { added, deleted } = await computeNumstatChurn(git, fileArg, log.all.length || 10);
      const churn = added + deleted;
      meta = {
        last_modified: log.latest?.date || null,
        last_author: log.latest?.author_name || null,
        churn,
        churn_added: added,
        churn_deleted: deleted,
        churn_commits: log.all.length || 0
      };
      gitMetaCache.set(cacheKey, meta);
    }

    if (!blameEnabled) return meta;
    const blameKey = `${cacheKey}::blame`;
    let lineAuthors = gitBlameCache.get(blameKey);
    if (!lineAuthors) {
      const blame = await git.raw(['blame', '--line-porcelain', '--', fileArg]);
      lineAuthors = parseLineAuthors(blame);
      if (lineAuthors) gitBlameCache.set(blameKey, lineAuthors);
    }
    return {
      ...meta,
      lineAuthors
    };
  } catch {
    return {};
  }
}

/**
 * Compute chunk authors from line-level blame data.
 * @param {string[]|null} lineAuthors
 * @param {number} startLine
 * @param {number} endLine
 * @returns {string[]}
 */
export function getChunkAuthorsFromLines(lineAuthors, startLine, endLine) {
  if (!Array.isArray(lineAuthors) || !lineAuthors.length) return [];
  const start = Math.max(1, Number.parseInt(startLine, 10) || 1);
  const end = Math.max(start, Number.parseInt(endLine, 10) || start);
  const authors = new Set();
  for (let i = start; i <= end && i <= lineAuthors.length; i += 1) {
    const author = lineAuthors[i - 1];
    if (author) authors.add(author);
  }
  return Array.from(authors);
}

/**
 * Fetch git metadata for a file/chunk (author, date, churn, blame authors).
 * Returns empty object when git is unavailable or fails.
 * @param {string} file
 * @param {number} [startLine]
 * @param {number} [endLine]
 * @param {{blame?:boolean,baseDir?:string}} [options]
 * @returns {Promise<{last_modified?:string,last_author?:string,churn?:number,chunk_authors?:string[]}|{}>}
 */
export async function getGitMeta(file, startLine = 1, endLine = 1, options = {}) {
  const fileMeta = await getGitMetaForFile(file, options);
  if (!fileMeta || !fileMeta.last_modified) return {};
  const { lineAuthors, ...meta } = fileMeta;
  if (!lineAuthors || options.blame === false) return meta;
  const chunkAuthors = getChunkAuthorsFromLines(lineAuthors, startLine, endLine);
  return chunkAuthors.length
    ? { ...meta, chunk_authors: chunkAuthors }
    : meta;
}

/**
 * Compute churn from git numstat output.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} file
 * @param {number} limit
 * @returns {Promise<{added:number,deleted:number}>}
 */
function parseLineAuthors(blameText) {
  const authors = [];
  let currentAuthor = null;
  for (const line of String(blameText || '').split('\n')) {
    if (line.startsWith('author ')) {
      currentAuthor = line.slice(7).trim();
      continue;
    }
    if (line.startsWith('\t')) {
      authors.push(currentAuthor || 'unknown');
    }
  }
  return authors.length ? authors : null;
}

async function computeNumstatChurn(git, file, limit) {
  try {
    const raw = await git.raw(['log', '--numstat', '-n', String(limit), '--format=', '--', file]);
    let added = 0;
    let deleted = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length < 2) continue;
      const addedVal = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10);
      const deletedVal = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10);
      if (Number.isFinite(addedVal)) added += addedVal;
      if (Number.isFinite(deletedVal)) deleted += deletedVal;
    }
    return { added, deleted };
  } catch {
    return { added: 0, deleted: 0 };
  }
}
