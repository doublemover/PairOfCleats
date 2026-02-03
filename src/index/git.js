import path from 'node:path';
import simpleGit from 'simple-git';
import { runScmCommand } from './scm/runner.js';
import {
  createLruCache,
  DEFAULT_CACHE_MB,
  DEFAULT_CACHE_TTL_MS,
  estimateJsonBytes
} from '../shared/cache.js';
import { isAbsolutePathNative, toPosix } from '../shared/files.js';
import { getChunkAuthorsFromLines } from './scm/annotate.js';

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

const warnedGitRoots = new Set();

const warnGitUnavailable = (repoRoot, message = 'Git metadata unavailable.') => {
  const key = repoRoot || 'unknown';
  if (warnedGitRoots.has(key)) return;
  warnedGitRoots.add(key);
  const suffix = repoRoot ? ` (${repoRoot})` : '';
  console.warn(`[git] ${message}${suffix}`);
};

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
    : (isAbsolutePathNative(file) ? path.dirname(file) : process.cwd());
  const relFile = isAbsolutePathNative(file) ? path.relative(baseDir, file) : file;
  const fileArg = toPosix(relFile);
  const cacheKey = `${baseDir}::${fileArg}`;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : null;
  const signal = options.signal || null;

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
      let blame = null;
      if (timeoutMs || signal) {
        try {
          const result = await runScmCommand('git', ['-C', baseDir, 'blame', '--line-porcelain', '--', fileArg], {
            outputMode: 'string',
            captureStdout: true,
            captureStderr: true,
            rejectOnNonZeroExit: false,
            timeoutMs,
            signal
          });
          blame = result.exitCode === 0 ? result.stdout : null;
        } catch {
          blame = null;
        }
      } else {
        blame = await git.raw(['blame', '--line-porcelain', '--', fileArg]);
      }
      lineAuthors = parseLineAuthors(blame);
      if (lineAuthors) gitBlameCache.set(blameKey, lineAuthors);
    }
    return {
      ...meta,
      lineAuthors
    };
  } catch {
    warnGitUnavailable(baseDir);
    return {};
  }
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
 * Resolve the current git branch for a repo.
 * @param {string} repoRoot
 * @returns {Promise<{branch:string|null,isRepo:boolean}>}
 */
export async function getRepoBranch(repoRoot) {
  try {
    const git = simpleGit({ baseDir: repoRoot });
    const status = await git.status();
    return { branch: status.current || null, isRepo: true };
  } catch {
    warnGitUnavailable(repoRoot, 'Git repo status unavailable.');
    return { branch: null, isRepo: false };
  }
}

/**
 * Resolve git provenance for a repo.
 * @param {string} repoRoot
 * @returns {Promise<{commit:string|null,dirty:boolean|null,branch:string|null,isRepo:boolean}>}
 */
export async function getRepoProvenance(repoRoot) {
  try {
    const git = simpleGit({ baseDir: repoRoot });
    const [commitRaw, status] = await Promise.all([
      git.revparse(['HEAD']),
      git.status()
    ]);
    const commit = String(commitRaw || '').trim() || null;
    const dirty = Array.isArray(status?.files) ? status.files.length > 0 : null;
    const branch = status?.current || null;
    return { commit, dirty, branch, isRepo: true };
  } catch {
    warnGitUnavailable(repoRoot, 'Git provenance unavailable.');
    return { commit: null, dirty: null, branch: null, isRepo: false };
  }
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
