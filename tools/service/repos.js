import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isAbsolutePathNative } from '../../src/shared/files.js';

const runGit = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const normalizeSignal = (value) => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
);

/**
 * Build a stable failure message for git subprocess results.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} result
 * @param {string} fallback
 * @returns {string}
 */
export const formatGitFailure = (result, fallback) => {
  const signal = normalizeSignal(result?.signal);
  if (signal) return `git interrupted by signal ${signal}`;
  if (typeof result?.error?.message === 'string' && result.error.message.trim().length > 0) {
    return result.error.message.trim();
  }
  const stderr = typeof result?.stderr === 'string' ? result.stderr.trim() : '';
  if (stderr) return stderr;
  const stdout = typeof result?.stdout === 'string' ? result.stdout.trim() : '';
  if (stdout) return stdout;
  if (Number.isInteger(result?.status)) {
    return `${fallback} (exit ${Number(result.status)})`;
  }
  return fallback;
};

export function resolveRepoPath(entry, baseDir) {
  if (!entry?.path) return null;
  return isAbsolutePathNative(entry.path) ? entry.path : path.join(baseDir, entry.path);
}

/**
 * Resolve a repo registry entry from a repo argument.
 * @param {string|null|undefined} repoArg
 * @param {Array<{id?:string,path?:string,syncPolicy?:string,branch?:string,cloneDepth?:number,url?:string}>} repoEntries
 * @param {string} baseDir
 * @returns {{id:string,path:string,syncPolicy?:string,branch?:string,cloneDepth?:number,url?:string}|null}
 */
export function resolveRepoEntry(repoArg, repoEntries, baseDir) {
  if (!repoArg) return null;
  const resolved = path.resolve(repoArg);
  return repoEntries.find((entry) => resolveRepoPath(entry, baseDir) === resolved)
    || repoEntries.find((entry) => entry.id === repoArg)
    || { id: repoArg, path: resolved, syncPolicy: 'none' };
}

export async function ensureRepo(entry, baseDir, defaultPolicy = 'pull') {
  const repoPath = resolveRepoPath(entry, baseDir);
  if (!repoPath) return { ok: false, message: 'Missing repo path.' };
  const branch = entry.branch || 'main';
  const policy = entry.syncPolicy || defaultPolicy;
  const depth = Number.isFinite(Number(entry.cloneDepth)) ? Math.max(0, Number(entry.cloneDepth)) : 0;

  if (!fsSync.existsSync(repoPath)) {
    if (!entry.url) return { ok: false, message: `Missing repo url for ${repoPath}` };
    await fs.mkdir(path.dirname(repoPath), { recursive: true });
    const cloneArgs = ['clone'];
    if (depth > 0) cloneArgs.push('--depth', String(depth));
    if (branch) cloneArgs.push('--branch', branch);
    cloneArgs.push(entry.url, repoPath);
    const clone = runGit(cloneArgs, process.cwd());
    if (clone.status !== 0) {
      return {
        ok: false,
        signal: normalizeSignal(clone.signal),
        message: formatGitFailure(clone, 'git clone failed')
      };
    }
    return { ok: true, repoPath, action: 'clone' };
  }

  if (policy === 'none') return { ok: true, repoPath, action: 'skip' };
  const args = policy === 'fetch' ? ['fetch', '--all', '--prune'] : ['pull', '--ff-only'];
  const sync = runGit(args, repoPath);
  if (sync.status !== 0) {
    return {
      ok: false,
      repoPath,
      signal: normalizeSignal(sync.signal),
      message: formatGitFailure(sync, 'git sync failed')
    };
  }
  return { ok: true, repoPath, action: policy };
}
