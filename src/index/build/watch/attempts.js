import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveRepoCacheRootPath } from '../../../shared/repo-paths.js';
import { getApplicationHome, getCacheRoot } from '../../../shared/cache-roots.js';
import { assertIndexCacheLease } from '../cache-lease.js';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { sameIdentityPath } from '../../../shared/indexing/build-pointer.js';
import { isPathWithinRoot } from '../../../shared/file-paths.js';

const DEFAULT_KEEP_SUCCESS = 2;
const DEFAULT_KEEP_FAILED = 1;

export const createWatchAttemptManager = ({ repoRoot, userConfig, log }) => {
  // Path selection alone must not invent a process-lifetime reader. Actual
  // writes require the caller's admitted writer; pruning takes both exclusions.
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const home = getApplicationHome();
  const cacheRoot = userConfig.cache?.root || getCacheRoot();
  if (!path.isAbsolute(cacheRoot) || !sameIdentityPath(path.join(cacheRoot, 'repos'), path.dirname(repoCacheRoot))) {
    throw new Error('Watch retention requires its effective canonical cache namespace.');
  }
  const attemptsRoot = path.join(buildsRoot, 'attempts');
  const keepSuccess = DEFAULT_KEEP_SUCCESS;
  const keepFailed = DEFAULT_KEEP_FAILED;
  const sessionId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  let attemptNumber = 0;
  const successAttempts = [];
  const failedAttempts = [];
  const issued = new WeakMap();
  let outcomeTail = Promise.resolve();

  const ensureRoot = async () => {
    assertNoSymlinkPath(path.parse(repoCacheRoot).root, attemptsRoot, { allowMissing: true });
    await fs.mkdir(attemptsRoot, { recursive: true });
    assertNoSymlinkPath(repoCacheRoot, attemptsRoot);
  };

  const createAttempt = async ({ lease } = {}) => {
    assertIndexCacheLease(lease, repoCacheRoot);
    attemptNumber += 1;
    const attemptId = `${sessionId}-${String(attemptNumber).padStart(3, '0')}`;
    const buildRoot = path.join(attemptsRoot, attemptId);
    await ensureRoot();
    await fs.mkdir(buildRoot);
    const identity = await fs.lstat(buildRoot, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error('Created watch attempt is not an ordinary owned directory.');
    const attempt = Object.freeze({ attemptId, buildId: attemptId, buildRoot });
    issued.set(attempt, { identity, queued: false, retired: false });
    return attempt;
  };

  const trimAttempts = async (list, keep) => {
    if (!Number.isFinite(keep) || list.length <= keep) return;
    const { withWatchRetentionExclusion } = await import('./retention.js');
    const receipt = await withWatchRetentionExclusion({ repoRoot, userConfig, repoCacheRoot, buildsRoot, home, cacheRoot,
      action: async ({ readReferences, remove }) => {
        let protectedRoots = (await readReferences()).roots;
        const isProtected = attempt => protectedRoots.some(root => isPathWithinRoot(root, attempt.buildRoot));
        let removals = Math.max(0, list.filter(attempt => !isProtected(attempt)).length - keep);
        let remaining = list.length, removed = 0;
        while (removals > 0 && remaining-- > 0) {
          const oldest = list.shift();
          try {
            protectedRoots = (await readReferences()).roots;
            if (isProtected(oldest)) { list.push(oldest); continue; }
            await remove(oldest, issued.get(oldest).identity);
            issued.get(oldest).retired = true;
            removals--; removed++;
            if (log) log(`[watch] Removed old attempt root: ${oldest.buildRoot}`);
          } catch (error) { if (!issued.get(oldest).retired) list.unshift(oldest); throw error; }
        }
        return { status: 'settled', removed };
      } });
    if (receipt.status === 'retained-protected' && log) log(`[watch] Retention deferred: ${receipt.reason}.`);
    return receipt;
  };

  const recordOutcomeImpl = async (attempt, ok, { committed = false, writersSettled = false } = {}) => {
    const record = issued.get(attempt);
    if (!record) throw new Error('Watch outcome requires its exact issued attempt owner.');
    if (!writersSettled) {
      if (log) log(`[watch] Retention deferred: attempt writer settlement is unconfirmed (${attempt.attemptId}).`);
      return { status: 'retained-protected', removed: 0, reason: 'writer-settlement-unconfirmed' };
    }
    if (record.retired) return { status: 'settled', removed: 0 };
    if (!record.queued) {
      record.queued = true;
      record.success = Boolean(ok || committed);
      (record.success ? successAttempts : failedAttempts).push(attempt);
    }
    if (record.success) {
      await trimAttempts(successAttempts, keepSuccess);
      await trimAttempts(failedAttempts, keepFailed);
    } else {
      await trimAttempts(failedAttempts, keepFailed);
    }
  };
  const recordOutcome = (...args) => {
    const work = outcomeTail.then(() => recordOutcomeImpl(...args));
    outcomeTail = work.catch(() => {});
    return work;
  };

  return {
    createAttempt,
    recordOutcome,
    attemptsRoot,
    keepSuccess,
    keepFailed
  };
};
