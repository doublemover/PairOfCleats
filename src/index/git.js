import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import { runScmCommand } from './scm/runner.js';
import {
  createLruCache,
  DEFAULT_CACHE_MB,
  DEFAULT_CACHE_TTL_MS,
  estimateJsonBytes
} from '../shared/cache.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
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
const gitRootFailureState = new Map();
const GIT_ROOT_FAILURE_BLOCK_MS = 5 * 60 * 1000;

const warnedGitRoots = new Set();

const warnGitUnavailable = (repoRoot, message = 'Git metadata unavailable.') => {
  const key = repoRoot || 'unknown';
  if (warnedGitRoots.has(key)) return;
  warnedGitRoots.add(key);
  const suffix = repoRoot ? ` (${repoRoot})` : '';
  console.warn(`[git] ${message}${suffix}`);
};

const resolveBlameMaxOutputBytes = (absFile) => {
  const fallback = 32 * 1024 * 1024;
  try {
    const size = Number(fs.statSync(absFile).size) || 0;
    if (size <= 0) return fallback;
    const estimate = Math.max(8 * 1024 * 1024, size * 6);
    return Math.min(128 * 1024 * 1024, Math.floor(estimate));
  } catch {
    return fallback;
  }
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
 * Fetch per-line git authors for a file.
 * Uses a dedicated blame cache so callers that only need blame data avoid
 * running file-level churn/log metadata commands.
 *
 * @param {string} file
 * @param {{baseDir?:string,timeoutMs?:number,signal?:AbortSignal|null}} [options]
 * @returns {Promise<string[]|null>}
 */
export async function getGitLineAuthorsForFile(file, options = {}) {
  const baseDir = options.baseDir
    ? path.resolve(options.baseDir)
    : (isAbsolutePathNative(file) ? path.dirname(file) : process.cwd());
  const relFile = isAbsolutePathNative(file) ? path.relative(baseDir, file) : file;
  const absFile = isAbsolutePathNative(file) ? file : path.resolve(baseDir, file);
  const fileArg = toPosix(relFile);
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : null;
  const signal = options.signal || null;
  const blameKey = buildLocalCacheKey({
    namespace: 'git-blame',
    payload: {
      baseDir,
      file: fileArg
    }
  }).key;

  if (isGitTemporarilyDisabled(baseDir)) return null;

  const cached = gitBlameCache.get(blameKey);
  if (cached) return cached;

  try {
    let blame = null;
    if (timeoutMs || signal) {
      const result = await runScmCommand('git', ['-C', baseDir, 'blame', '--line-porcelain', '--', fileArg], {
        outputMode: 'string',
        captureStdout: true,
        captureStderr: true,
        rejectOnNonZeroExit: false,
        maxOutputBytes: resolveBlameMaxOutputBytes(absFile),
        timeoutMs,
        signal
      });
      if (result.exitCode !== 0) {
        throw createGitNonZeroExitError('git blame', result);
      }
      blame = result.stdout;
    } else {
      const git = simpleGit({ baseDir });
      blame = await git.raw(['blame', '--line-porcelain', '--', fileArg]);
    }
    const lineAuthors = parseLineAuthors(blame);
    if (lineAuthors) gitBlameCache.set(blameKey, lineAuthors);
    clearGitFailureState(baseDir);
    return lineAuthors || null;
  } catch (err) {
    recordGitFailure(baseDir, err);
    warnGitUnavailable(baseDir);
    return null;
  }
}

/**
 * Fetch git metadata for an entire file, with optional line-level blame.
 *
 * Uses per-root caches and a temporary backoff circuit so repeated git
 * timeouts/unavailability do not repeatedly stall hot indexing paths.
 * Returns `{}` when git is unavailable or currently backed off.
 *
 * @param {string} file
 * @param {{
 *   blame?:boolean,
 *   includeChurn?:boolean,
 *   churnWindowCommits?:number,
 *   timeoutMs?:number,
 *   signal?:AbortSignal|null,
 *   baseDir?:string
 * }} [options]
 * @returns {Promise<{last_modified?:string,last_author?:string,churn?:number,churn_added?:number,churn_deleted?:number,churn_commits?:number,lineAuthors?:string[]}|{}>}
 */
export async function getGitMetaForFile(file, options = {}) {
  const blameEnabled = options.blame !== false;
  const includeChurn = options.includeChurn !== false;
  const baseDir = options.baseDir
    ? path.resolve(options.baseDir)
    : (isAbsolutePathNative(file) ? path.dirname(file) : process.cwd());
  const relFile = isAbsolutePathNative(file) ? path.relative(baseDir, file) : file;
  const absFile = isAbsolutePathNative(file) ? file : path.resolve(baseDir, file);
  const fileArg = toPosix(relFile);
  const churnWindowCommits = resolveChurnWindowCommits(options.churnWindowCommits);
  const cacheKey = buildLocalCacheKey({
    namespace: 'git-meta',
    payload: {
      baseDir,
      file: fileArg,
      includeChurn,
      churnWindowCommits
    }
  }).key;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : null;
  const signal = options.signal || null;

  if (isGitTemporarilyDisabled(baseDir)) {
    return {};
  }

  const cached = gitMetaCache.get(cacheKey);
  if (cached && !blameEnabled) return cached;

  try {
    const git = simpleGit({ baseDir });
    let meta = cached;
    if (!meta) {
      if (timeoutMs || signal) {
        meta = await computeMetaWithFastCommands({
          baseDir,
          fileArg,
          timeoutMs,
          signal,
          includeChurn,
          churnWindowCommits
        });
      } else {
        const log = await git.log({ file: fileArg, n: churnWindowCommits });
        const churn = includeChurn
          ? await computeNumstatChurn(git, fileArg, log.all.length || churnWindowCommits)
          : null;
        meta = {
          last_modified: log.latest?.date || null,
          last_author: log.latest?.author_name || null,
          churn: churn ? churn.added + churn.deleted : null,
          churn_added: churn?.added ?? null,
          churn_deleted: churn?.deleted ?? null,
          churn_commits: churn ? (log.all.length || 0) : null
        };
      }
      if (meta && (meta.last_modified || meta.last_author)) {
        gitMetaCache.set(cacheKey, meta);
      }
    }

    if (!meta) return {};
    clearGitFailureState(baseDir);
    if (!blameEnabled) return meta;
    const lineAuthors = await getGitLineAuthorsForFile(absFile, {
      baseDir,
      timeoutMs,
      signal
    });
    return {
      ...meta,
      lineAuthors
    };
  } catch (err) {
    recordGitFailure(baseDir, err);
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

const resolveChurnWindowCommits = (rawValue) => {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : 10;
};

const isGitTemporarilyDisabled = (baseDir) => {
  const entry = gitRootFailureState.get(baseDir);
  if (!entry) return false;
  if (entry.blockedUntil > Date.now()) return true;
  gitRootFailureState.delete(baseDir);
  return false;
};

const clearGitFailureState = (baseDir) => {
  if (!baseDir) return;
  gitRootFailureState.delete(baseDir);
};

/**
 * Record a git failure and compute temporary/permanent disable windows.
 *
 * Fatal “git unavailable” signatures disable lookups indefinitely for the
 * repo root. Timeout-like failures or repeated transient failures trigger a
 * temporary cooldown to protect indexing latency.
 *
 * @param {string} baseDir
 * @param {Error|any} err
 * @returns {void}
 */
const recordGitFailure = (baseDir, err) => {
  if (!baseDir) return;
  const now = Date.now();
  const code = String(err?.code || err?.cause?.code || '').toUpperCase();
  const message = String(err?.message || err?.cause?.message || '').toLowerCase();
  const prior = gitRootFailureState.get(baseDir) || {
    failures: 0,
    blockedUntil: 0
  };
  const timeoutLike = code === 'SUBPROCESS_TIMEOUT' || code === 'ABORT_ERR';
  const fatalUnavailable = code === 'ENOENT'
    || message.includes('not a git repository')
    || message.includes('git metadata unavailable')
    || message.includes('is not recognized as an internal or external command')
    || message.includes('spawn git');
  const failures = prior.failures + 1;
  const blockedUntil = fatalUnavailable
    ? Number.POSITIVE_INFINITY
    : (timeoutLike || failures >= 3
      ? (now + GIT_ROOT_FAILURE_BLOCK_MS)
      : prior.blockedUntil);
  gitRootFailureState.set(baseDir, { failures, blockedUntil });
};

const parseLogHead = (stdout) => {
  const raw = String(stdout || '').trim();
  if (!raw) return { lastModifiedAt: null, lastAuthor: null };
  const [lastModifiedAtRaw, ...authorParts] = raw.split('\0');
  const lastModifiedAt = String(lastModifiedAtRaw || '').trim() || null;
  const lastAuthor = authorParts.join('\0').trim() || null;
  return { lastModifiedAt, lastAuthor };
};

const parseNumstatChurnText = (stdout) => {
  let added = 0;
  let deleted = 0;
  for (const line of String(stdout || '').split('\n')) {
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
};

const createGitNonZeroExitError = (label, result) => {
  const exitCode = Number(result?.exitCode);
  const codeSuffix = Number.isFinite(exitCode) ? String(Math.floor(exitCode)) : 'NONZERO';
  const stderr = String(result?.stderr || '').trim();
  const stdout = String(result?.stdout || '').trim();
  const details = stderr || stdout || `${label} exited with code ${codeSuffix}`;
  const err = new Error(details);
  err.code = `GIT_EXIT_${codeSuffix}`;
  err.exitCode = exitCode;
  return err;
};

const computeMetaWithFastCommands = async ({
  baseDir,
  fileArg,
  timeoutMs,
  signal,
  includeChurn,
  churnWindowCommits
}) => {
  const headResult = await runScmCommand('git', [
    '-C',
    baseDir,
    'log',
    '-n',
    '1',
    '--date=iso-strict',
    '--format=%aI%x00%an',
    '--',
    fileArg
  ], {
    outputMode: 'string',
    captureStdout: true,
    captureStderr: true,
    rejectOnNonZeroExit: false,
    timeoutMs,
    signal
  });
  if (headResult.exitCode !== 0) throw createGitNonZeroExitError('git log', headResult);
  const { lastModifiedAt, lastAuthor } = parseLogHead(headResult.stdout);
  if (!includeChurn) {
    return {
      last_modified: lastModifiedAt,
      last_author: lastAuthor,
      churn: null,
      churn_added: null,
      churn_deleted: null,
      churn_commits: null
    };
  }
  try {
    const churnResult = await runScmCommand('git', [
      '-C',
      baseDir,
      'log',
      '--numstat',
      '-n',
      String(churnWindowCommits),
      '--format=',
      '--',
      fileArg
    ], {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false,
      timeoutMs,
      signal
    });
    const churn = churnResult.exitCode === 0
      ? parseNumstatChurnText(churnResult.stdout)
      : null;
    // Non-zero/timeout fast-path churn is treated as unknown (null), not zero.
    // This avoids silently undercounting churn on slow repositories.
    return {
      last_modified: lastModifiedAt,
      last_author: lastAuthor,
      churn: churn ? (churn.added + churn.deleted) : null,
      churn_added: churn?.added ?? null,
      churn_deleted: churn?.deleted ?? null,
      churn_commits: null
    };
  } catch {
    return {
      last_modified: lastModifiedAt,
      last_author: lastAuthor,
      churn: null,
      churn_added: null,
      churn_deleted: null,
      churn_commits: null
    };
  }
};

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
    return parseNumstatChurnText(raw);
  } catch {
    return null;
  }
}
