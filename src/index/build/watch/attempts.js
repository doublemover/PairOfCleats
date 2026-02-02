import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getBuildsRoot } from '../../../shared/dict-utils.js';

const DEFAULT_KEEP_SUCCESS = 2;
const DEFAULT_KEEP_FAILED = 1;

const removeAttemptRoot = async (buildRoot, log) => {
  if (!buildRoot) return;
  try {
    await fs.rm(buildRoot, { recursive: true, force: true });
    if (log) log(`[watch] Removed old attempt root: ${buildRoot}`);
  } catch {}
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
    while (list.length > keep) {
      const oldest = list.shift();
      await removeAttemptRoot(oldest?.buildRoot, log);
    }
  };

  const recordOutcome = async (attempt, ok) => {
    if (!attempt?.buildRoot) return;
    if (ok) {
      successAttempts.push(attempt);
      await trimAttempts(successAttempts, keepSuccess);
      await trimAttempts(failedAttempts, keepFailed);
    } else {
      failedAttempts.push(attempt);
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
