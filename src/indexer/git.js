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
  const blameEnabled = options.blame !== false;
  const baseDir = options.baseDir
    ? path.resolve(options.baseDir)
    : (path.isAbsolute(file) ? path.dirname(file) : process.cwd());
  const relFile = path.isAbsolute(file) ? path.relative(baseDir, file) : file;
  const fileArg = relFile.split(path.sep).join('/');
  const cacheKey = `${baseDir}::${fileArg}`;
  const start = Math.max(1, Number.parseInt(startLine, 10) || 1);
  const end = Math.max(start, Number.parseInt(endLine, 10) || start);

  const cached = gitMetaCache.get(cacheKey);
  if (cached) {
    if (!blameEnabled) return cached;
    let blameData = {};
    try {
      const git = simpleGit({ baseDir });
      const blame = await git.raw(['blame', '-L', `${start},${end}`, '--', fileArg]);
      const authors = new Set();
      for (const line of blame.split('\n')) {
        const m = line.match(/^\^?\w+\s+\(([^)]+)\s+\d{4}/);
        if (m) authors.add(m[1].trim());
      }
      blameData = { chunk_authors: Array.from(authors) };
    } catch {}
    return {
      ...cached,
      ...blameData
    };
  }

  try {
    const git = simpleGit({ baseDir });
    const log = await git.log({ file: fileArg, n: 10 });
    const { added, deleted } = await computeNumstatChurn(git, fileArg, log.all.length || 10);
    const churn = added + deleted;
    const meta = {
      last_modified: log.latest?.date || null,
      last_author: log.latest?.author_name || null,
      churn,
      churn_added: added,
      churn_deleted: deleted,
      churn_commits: log.all.length || 0
    };
    gitMetaCache.set(cacheKey, meta);
    let blameData = {};
    if (blameEnabled) {
      try {
        const blame = await git.raw(['blame', '-L', `${start},${end}`, '--', fileArg]);
        const authors = new Set();
        for (const line of blame.split('\n')) {
          const m = line.match(/^\^?\w+\s+\(([^)]+)\s+\d{4}/);
          if (m) authors.add(m[1].trim());
        }
        blameData = { chunk_authors: Array.from(authors) };
      } catch {}
    }

    return {
      ...meta,
      ...blameData
    };
  } catch {
    return {};
  }
}

/**
 * Compute churn from git numstat output.
 * @param {import('simple-git').SimpleGit} git
 * @param {string} file
 * @param {number} limit
 * @returns {Promise<{added:number,deleted:number}>}
 */
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
