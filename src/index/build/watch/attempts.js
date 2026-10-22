import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getBuildsRoot, getCurrentBuildInfo } from '../../../shared/dict-utils.js';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { sameIdentityPath } from '../../../shared/indexing/build-pointer.js';

const DEFAULT_KEEP_SUCCESS = 2;
const DEFAULT_KEEP_FAILED = 1;

const removeAttemptRoot = async (buildRoot, log) => {
  if (!buildRoot) return;
  await fs.rm(buildRoot, { recursive: true, force: true });
  if (log) log(`[watch] Removed old attempt root: ${buildRoot}`);
};

export const createWatchAttemptManager = ({ repoRoot, userConfig, log }) => {
  const buildsRoot = getBuildsRoot(repoRoot, userConfig);
  const attemptsRoot = path.join(buildsRoot, 'attempts');
  const keepSuccess = DEFAULT_KEEP_SUCCESS;
  const keepFailed = DEFAULT_KEEP_FAILED;
  const sessionId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  let attemptNumber = 0;
  const successAttempts = [];
  const failedAttempts = [];

  const ensureRoot = async () => {
    await fs.mkdir(attemptsRoot, { recursive: true });
  };

  const createAttempt = async () => {
    attemptNumber += 1;
    const attemptId = `${sessionId}-${String(attemptNumber).padStart(3, '0')}`;
    const buildRoot = path.join(attemptsRoot, attemptId);
    await ensureRoot();
    return { attemptId, buildId: attemptId, buildRoot };
  };

  const trimAttempts = async (list, keep) => {
    if (!Number.isFinite(keep)) return;
    let remaining = list.length;
    while (list.length > keep && remaining-- > 0) {
      const oldest = list.shift();
      const target = path.resolve(oldest.buildRoot);
      if (!sameIdentityPath(path.dirname(target), attemptsRoot)) {
        list.unshift(oldest);
        throw new Error(`Watch retention target is not a direct attempt root: ${target}`);
      }
      try {
        await fs.lstat(path.join(buildsRoot, 'current.json'));
        const current = getCurrentBuildInfo(repoRoot, userConfig);
        if (!current) throw new Error('Cannot establish published roots for watch retention.');
        const protectedRoots = [current.buildRoot, current.activeRoot, ...Object.values(current.buildRoots || {})];
        if (protectedRoots.some(root => root && sameIdentityPath(root, target))) {
          list.push(oldest);
          continue;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') { list.unshift(oldest); throw error; }
      }
      try {
        assertNoSymlinkPath(attemptsRoot, target, { allowMissing: true });
        await removeAttemptRoot(oldest?.buildRoot, log);
      } catch (error) { list.unshift(oldest); throw error; }
    }
  };

  const recordOutcome = async (attempt, ok, { committed = false } = {}) => {
    if (!attempt?.buildRoot) return;
    if (ok || committed) {
      successAttempts.push(attempt);
      await trimAttempts(successAttempts, keepSuccess);
      await trimAttempts(failedAttempts, keepFailed);
    } else {
      failedAttempts.push(attempt);
      await trimAttempts(failedAttempts, keepFailed);
    }
  };

  return {
    createAttempt,
    recordOutcome,
    attemptsRoot,
    keepSuccess,
    keepFailed
  };
};
