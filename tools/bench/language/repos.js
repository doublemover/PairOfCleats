import fs from 'node:fs';
import path from 'node:path';
import { hasChunkMetaArtifactsSync } from '../../../src/shared/index-artifact-helpers.js';
import { runCommand } from '../../shared/cli-utils.js';
import { getIndexDir, getRepoCacheRoot, loadUserConfig, resolveSqlitePaths } from '../../shared/dict-utils.js';
import { emitBenchLog } from './logging.js';

let gitCommandRunner = runCommand;

const canRun = (cmd, args) => {
  try {
    const result = gitCommandRunner(cmd, args, { encoding: 'utf8' });
    return result.ok;
  } catch {
    return false;
  }
};
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 120000;
export const DEFAULT_MIRROR_TIMEOUT_MS = 30000;
export const DEFAULT_MIRROR_REFRESH_MS = 4 * 60 * 60 * 1000;

export const buildNonInteractiveGitEnv = (baseEnv = process.env) => ({
  ...baseEnv,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'Never'
});

export const __setGitCommandRunnerForTests = (runner) => {
  gitCommandRunner = typeof runner === 'function' ? runner : runCommand;
};

const trimToFirstLine = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    || ''
);

const normalizeStatusCode = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isTimeoutFailure = (error) => {
  if (!error || typeof error !== 'object') return false;
  if (error.timedOut === true) return true;
  if (String(error.code || '').toUpperCase() === 'ETIMEDOUT') return true;
  const text = [
    error.shortMessage,
    error.message,
    error.stderr,
    error.stdout
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join('\n');
  return /\btimed out\b/i.test(text);
};

const buildGitFailureResult = (error, { timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS } = {}) => {
  const timeout = isTimeoutFailure(error);
  const stderr = timeout
    ? `timed out after ${timeoutMs}ms`
    : trimToFirstLine(error?.stderr || error?.stdout || error?.shortMessage || error?.message || error)
      || 'command failed';
  const rawStatus = error?.exitCode ?? error?.status;
  const status = normalizeStatusCode(rawStatus);
  return {
    ok: false,
    status,
    stdout: typeof error?.stdout === 'string' ? error.stdout : '',
    stderr,
    timedOut: timeout
  };
};

const runGitCommand = (args, { timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS, repoPath = null } = {}) => {
  const fullArgs = repoPath ? ['-C', repoPath, ...args] : args;
  try {
    const result = gitCommandRunner('git', fullArgs, {
      encoding: 'utf8',
      timeoutMs,
      env: buildNonInteractiveGitEnv()
    });
    return {
      ok: result?.ok === true,
      status: normalizeStatusCode(result?.status),
      stdout: typeof result?.stdout === 'string' ? result.stdout : '',
      stderr: typeof result?.stderr === 'string' ? result.stderr : '',
      timedOut: result?.timedOut === true
    };
  } catch (error) {
    return buildGitFailureResult(error, { timeoutMs });
  }
};

const runGitInRepo = (repoPath, args, { timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS } = {}) => {
  return runGitCommand(args, { timeoutMs, repoPath });
};

const firstOutputLine = (result) => {
  const text = trimToFirstLine(result?.stderr || result?.stdout || '');
  return text || 'no output';
};

const collectOutputLines = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);

const summarizeFailureTail = (result, { maxLines = 4 } = {}) => {
  const stderrLines = collectOutputLines(result?.stderr);
  const stdoutLines = collectOutputLines(result?.stdout);
  const merged = [...stderrLines, ...stdoutLines];
  if (merged.length === 0) return 'no output';
  const selected = merged.slice(-Math.max(1, Math.floor(maxLines)));
  const status = normalizeStatusCode(result?.status);
  const prefix = [
    Number.isFinite(status) ? `status=${status}` : null,
    result?.timedOut === true ? 'timedOut=1' : null
  ].filter(Boolean);
  return [
    prefix.length > 0 ? `${prefix.join(' ')}` : null,
    selected.join(' | ')
  ].filter(Boolean).join(' ');
};

const runGit = (args, { timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS } = {}) => {
  return runGitCommand(args, { timeoutMs });
};

const sanitizeRepoMirrorName = (repo) => (
  String(repo || '')
    .trim()
    .replace(/[\\/]+/g, '__')
    .replace(/[^a-z0-9_.-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    || 'repo'
);

export const resolveMirrorCacheRoot = ({ reposRoot } = {}) => (
  path.join(path.resolve(reposRoot || process.cwd()), '.mirror-cache')
);

export const resolveMirrorRepoPath = ({ mirrorCacheRoot, repo } = {}) => (
  path.join(path.resolve(mirrorCacheRoot || process.cwd()), `${sanitizeRepoMirrorName(repo)}.git`)
);

export const resolveMirrorRefreshMs = (value, fallback = DEFAULT_MIRROR_REFRESH_MS) => {
  if (value == null) return fallback;
  if (typeof value === 'string' && value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return fallback;
};

export const shouldRefreshMirror = ({ mirrorPath, refreshMs = DEFAULT_MIRROR_REFRESH_MS } = {}) => {
  if (!mirrorPath || !fs.existsSync(mirrorPath)) return true;
  const refreshWindowMs = resolveMirrorRefreshMs(refreshMs, DEFAULT_MIRROR_REFRESH_MS);
  if (refreshWindowMs <= 0) return true;
  try {
    const stat = fs.statSync(mirrorPath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs >= refreshWindowMs;
  } catch {
    return true;
  }
};

const ensureMirrorUpToDate = ({
  repo,
  mirrorPath,
  refreshMs = DEFAULT_MIRROR_REFRESH_MS,
  timeoutMs = DEFAULT_MIRROR_TIMEOUT_MS
}) => {
  if (!canRun('git', ['--version'])) {
    return { ok: false, reason: 'git unavailable', action: 'disabled', mirrorPath };
  }
  const remoteUrl = `https://github.com/${repo}.git`;
  const exists = fs.existsSync(mirrorPath);
  if (!exists) {
    const cloneResult = runGit(['clone', '--mirror', remoteUrl, mirrorPath], { timeoutMs });
    if (!cloneResult.ok) {
      const cloneTimedOut = cloneResult.timedOut === true || /\btimed out\b/i.test(firstOutputLine(cloneResult));
      return {
        ok: false,
        reason: cloneTimedOut
          ? `mirror clone timed out after ${timeoutMs}ms`
          : `mirror clone failed: ${firstOutputLine(cloneResult)}`,
        action: cloneTimedOut ? 'clone-timeout' : 'clone-failed',
        mirrorPath,
        remoteUrl
      };
    }
    return { ok: true, action: 'cloned', mirrorPath, remoteUrl };
  }
  if (!shouldRefreshMirror({ mirrorPath, refreshMs })) {
    return { ok: true, action: 'reused', mirrorPath, remoteUrl };
  }
  const refreshResult = runGit(['-C', mirrorPath, 'remote', 'update', '--prune'], { timeoutMs });
  if (!refreshResult.ok) {
    const refreshTimedOut = refreshResult.timedOut === true || /\btimed out\b/i.test(firstOutputLine(refreshResult));
    return {
      ok: false,
      reason: refreshTimedOut
        ? `mirror refresh timed out after ${timeoutMs}ms`
        : `mirror refresh failed: ${firstOutputLine(refreshResult)}`,
      action: refreshTimedOut ? 'refresh-timeout' : 'refresh-failed',
      mirrorPath,
      remoteUrl
    };
  }
  return { ok: true, action: 'updated', mirrorPath, remoteUrl };
};

export const tryMirrorClone = ({
  repo,
  repoPath,
  mirrorCacheRoot,
  mirrorRefreshMs = DEFAULT_MIRROR_REFRESH_MS,
  timeoutMs = DEFAULT_MIRROR_TIMEOUT_MS,
  onLog = null
}) => {
  if (!repo || !repoPath || !mirrorCacheRoot) {
    return { attempted: false, ok: false, reason: 'missing mirror inputs' };
  }
  if (!canRun('git', ['--version'])) {
    return { attempted: false, ok: false, reason: 'git unavailable' };
  }
  try {
    fs.mkdirSync(mirrorCacheRoot, { recursive: true });
  } catch (err) {
    return { attempted: true, ok: false, reason: err?.message || String(err) };
  }
  try {
    const mirrorPath = resolveMirrorRepoPath({ mirrorCacheRoot, repo });
    const mirrorStatus = ensureMirrorUpToDate({
      repo,
      mirrorPath,
      refreshMs: mirrorRefreshMs,
      timeoutMs
    });
    if (!mirrorStatus.ok) {
      return {
        attempted: true,
        ok: false,
        reason: mirrorStatus.reason || 'mirror sync failed',
        mirrorPath,
        mirrorAction: mirrorStatus.action
      };
    }
    const cloneResult = runGit([
      '-c',
      'core.longpaths=true',
      '-c',
      'checkout.workers=0',
      '-c',
      'checkout.thresholdForParallelism=0',
      'clone',
      mirrorPath,
      repoPath
    ], { timeoutMs });
    if (!cloneResult.ok) {
      const cloneTimedOut = cloneResult.timedOut === true || /\btimed out\b/i.test(firstOutputLine(cloneResult));
      return {
        attempted: true,
        ok: false,
        reason: cloneTimedOut
          ? `mirror checkout timed out after ${timeoutMs}ms`
          : `mirror checkout failed: ${firstOutputLine(cloneResult)}`,
        mirrorPath,
        mirrorAction: cloneTimedOut ? 'checkout-timeout' : 'checkout-failed'
      };
    }
    const remoteUrl = `https://github.com/${repo}.git`;
    const remoteSetResult = runGit(['-C', repoPath, 'remote', 'set-url', 'origin', remoteUrl], { timeoutMs });
    if (!remoteSetResult.ok && typeof onLog === 'function') {
      onLog(
        `[clone] mirror clone succeeded but remote reset failed (${path.basename(repoPath)}): ${firstOutputLine(remoteSetResult)}`,
        'warn'
      );
    }
    return {
      attempted: true,
      ok: true,
      mirrorPath,
      mirrorAction: mirrorStatus.action,
      remoteUrl
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      reason: trimToFirstLine(err?.message || err) || 'mirror operation failed',
      mirrorAction: 'exception'
    };
  }
};

export const parseSubmoduleStatusLines = (value) => {
  const rows = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];
  for (const row of rows) {
    const marker = ['-', '+', 'U'].includes(row[0]) ? row[0] : ' ';
    const payload = marker === ' ' ? row : row.slice(1).trimStart();
    const match = payload.match(/^([0-9a-f]{7,40})\s+(\S+)/i);
    if (!match) continue;
    parsed.push({
      marker,
      sha: match[1],
      path: match[2],
      missing: marker === '-',
      dirty: marker === '+' || marker === 'U'
    });
  }
  return parsed;
};

export const ensureRepoBenchmarkReady = ({
  repoPath,
  onLog = null,
  preflightTimeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS,
  pullLfs = true
}) => {
  const log = (message, level = 'info') => {
    if (typeof onLog !== 'function') return;
    onLog(message, level);
  };
  const summary = {
    ok: true,
    failureReason: null,
    failureCode: null,
    failureDetail: null,
    gitRepo: false,
    submodules: {
      detected: 0,
      initialMissing: 0,
      initialDirty: 0,
      missing: 0,
      dirty: 0,
      updated: false,
      rewriteGithubSshToHttps: false
    },
    lfs: {
      supported: false,
      tracked: 0,
      pulled: false
    }
  };
  const markFailure = ({
    reason,
    code = null,
    detail = null
  }) => {
    summary.ok = false;
    summary.failureReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'preflight';
    summary.failureCode = normalizeStatusCode(code);
    summary.failureDetail = typeof detail === 'string' && detail.trim()
      ? detail.trim()
      : null;
  };
  if (!repoPath || !fs.existsSync(repoPath)) return summary;
  if (!canRun('git', ['--version'])) return summary;
  const repoName = path.basename(repoPath);

  const gitRepo = runGitInRepo(repoPath, ['rev-parse', '--is-inside-work-tree'], {
    timeoutMs: Math.min(15000, preflightTimeoutMs)
  });
  if (!gitRepo.ok || String(gitRepo.stdout || '').trim() !== 'true') {
    return summary;
  }
  summary.gitRepo = true;

  const gitmodulesPath = path.join(repoPath, '.gitmodules');
  if (fs.existsSync(gitmodulesPath)) {
    const statusResult = runGitInRepo(repoPath, ['submodule', 'status', '--recursive'], {
      timeoutMs: preflightTimeoutMs
    });
    if (!statusResult.ok) {
      const detail = summarizeFailureTail(statusResult);
      log(
        `[repo-preflight] submodule status check failed (${repoName}): ${detail}`,
        'warn'
      );
      markFailure({
        reason: 'preflight-submodule-status',
        code: statusResult.status,
        detail
      });
      return summary;
    } else {
      const entries = parseSubmoduleStatusLines(statusResult.stdout);
      summary.submodules.detected = entries.length;
      const initialMissing = entries.filter((entry) => entry.missing).length;
      const initialDirty = entries.filter((entry) => entry.dirty).length;
      summary.submodules.initialMissing = initialMissing;
      summary.submodules.initialDirty = initialDirty;
      summary.submodules.missing = initialMissing;
      summary.submodules.dirty = initialDirty;
      if (initialMissing > 0 || initialDirty > 0) {
        runGitInRepo(repoPath, ['submodule', 'sync', '--recursive'], {
          timeoutMs: Math.min(preflightTimeoutMs, 45000)
        });
        let updateArgs = ['submodule', 'update', '--init', '--recursive', '--jobs', '8'];
        try {
          const gitmodulesRaw = fs.readFileSync(gitmodulesPath, 'utf8');
          if (/git@github\.com:/i.test(gitmodulesRaw)) {
            summary.submodules.rewriteGithubSshToHttps = true;
            updateArgs = [
              '-c',
              'url.https://github.com/.insteadOf=git@github.com:',
              ...updateArgs
            ];
            log(`[repo-preflight] rewriting GitHub SSH submodule URLs to HTTPS (${repoName}).`);
          }
        } catch {}
        const updateResult = runGitInRepo(
          repoPath,
          updateArgs,
          { timeoutMs: preflightTimeoutMs }
        );
        if (!updateResult.ok) {
          const detail = summarizeFailureTail(updateResult);
          log(
            `[repo-preflight] submodule init failed (${repoName}): ${detail}`,
            'warn'
          );
          markFailure({
            reason: 'preflight-submodule-init',
            code: updateResult.status,
            detail
          });
          return summary;
        } else {
          const verifyResult = runGitInRepo(repoPath, ['submodule', 'status', '--recursive'], {
            timeoutMs: preflightTimeoutMs
          });
          if (!verifyResult.ok) {
            const detail = summarizeFailureTail(verifyResult);
            log(
              `[repo-preflight] submodule verification failed (${repoName}): ${detail}`,
              'warn'
            );
            markFailure({
              reason: 'preflight-submodule-verify',
              code: verifyResult.status,
              detail
            });
            return summary;
          }
          const verifiedEntries = parseSubmoduleStatusLines(verifyResult.stdout);
          summary.submodules.missing = verifiedEntries.filter((entry) => entry.missing).length;
          summary.submodules.dirty = verifiedEntries.filter((entry) => entry.dirty).length;
          if (summary.submodules.missing > 0 || summary.submodules.dirty > 0) {
            const detail = `remaining missing=${summary.submodules.missing}, dirty=${summary.submodules.dirty}`;
            log(`[repo-preflight] submodule initialization incomplete (${repoName}): ${detail}.`, 'warn');
            markFailure({
              reason: 'preflight-submodule-incomplete',
              code: null,
              detail
            });
            return summary;
          }
          summary.submodules.updated = true;
          log(
            `[repo-preflight] submodules ready (${repoName}) ` +
            `(missing=${summary.submodules.initialMissing}, dirty=${summary.submodules.initialDirty}).`
          );
        }
      }
    }
  }

  if (pullLfs) {
    const lfsVersion = runCommand('git', ['lfs', 'version'], {
      encoding: 'utf8',
      timeoutMs: Math.min(preflightTimeoutMs, 15000)
    });
    if (lfsVersion.ok) {
      summary.lfs.supported = true;
      const lfsFiles = runGitInRepo(repoPath, ['lfs', 'ls-files', '--name-only'], {
        timeoutMs: preflightTimeoutMs
      });
      if (!lfsFiles.ok) {
        log(`[repo-preflight] git-lfs scan failed (${repoName}): ${firstOutputLine(lfsFiles)}`, 'warn');
      } else {
        const tracked = String(lfsFiles.stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        summary.lfs.tracked = tracked.length;
        if (tracked.length > 0) {
          const pullResult = runGitInRepo(repoPath, ['lfs', 'pull'], { timeoutMs: preflightTimeoutMs });
          if (!pullResult.ok) {
            log(`[repo-preflight] git-lfs pull failed (${repoName}): ${firstOutputLine(pullResult)}`, 'warn');
          } else {
            summary.lfs.pulled = true;
            log(`[repo-preflight] git-lfs ready (${repoName}, ${tracked.length} tracked file(s)).`);
          }
        }
      }
    }
  }

  return summary;
};

export const resolveCloneTool = ({ onLog = null } = {}) => {
  const gitAvailable = canRun('git', ['--version']);
  const ghAvailable = canRun('gh', ['--version']);
  const preferGit = process.platform === 'win32' && gitAvailable;
  if (preferGit) {
    return {
      label: 'git',
      supportsMirrorClone: true,
      buildArgs: (repo, repoPath) => [
        '-c',
        'core.longpaths=true',
        '-c',
        'checkout.workers=0',
        '-c',
        'checkout.thresholdForParallelism=0',
        'clone',
        `https://github.com/${repo}.git`,
        repoPath
      ]
    };
  }
  if (ghAvailable) {
    return {
      label: 'gh',
      supportsMirrorClone: false,
      buildArgs: (repo, repoPath) => ['repo', 'clone', repo, repoPath]
    };
  }
  if (gitAvailable) {
    return {
      label: 'git',
      supportsMirrorClone: true,
      buildArgs: (repo, repoPath) => [
        '-c',
        'checkout.workers=0',
        '-c',
        'checkout.thresholdForParallelism=0',
        'clone',
        `https://github.com/${repo}.git`,
        repoPath
      ]
    };
  }
  emitBenchLog(onLog, 'GitHub CLI (gh) or git is required to clone benchmark repos.', 'error');
  process.exit(1);
};

export const ensureLongPathsSupport = ({ onLog = null } = {}) => {
  if (process.platform !== 'win32') return;
  if (canRun('git', ['--version'])) {
    try {
      runCommand('git', ['config', '--global', 'core.longpaths', 'true'], { stdio: 'ignore' });
    } catch {}
  }
  let regResult;
  try {
    regResult = runCommand(
      'reg',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'],
      { encoding: 'utf8' }
    );
  } catch {
    regResult = null;
  }
  if (!regResult || !regResult.ok) {
    emitBenchLog(onLog, 'Warning: Unable to confirm Windows long path setting. Enable LongPathsEnabled=1 if clones fail.', 'warn');
    return;
  }
  const match = String(regResult.stdout || '').match(/LongPathsEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i);
  if (!match) return;
  const value = Number.parseInt(match[1], 16);
  if (value === 0) {
    emitBenchLog(onLog, 'Warning: Windows long paths are disabled. Enable LongPathsEnabled=1 to avoid clone failures.', 'warn');
  }
};

export const resolveRepoDir = ({ reposRoot, repo, language }) => {
  const safeName = repo.replace('/', '__');
  return path.join(reposRoot, language, safeName);
};

export const resolveRepoCacheRoot = ({ repoPath, cacheRoot }) => {
  return getRepoCacheRoot(repoPath, { cache: { root: cacheRoot } });
};

/**
 * Determine whether bench-language must build sparse artifacts before running.
 *
 * @param {string} repoRoot
 * @returns {boolean}
 */
export const needsIndexArtifacts = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
  const hasChunkMeta = (dir) => hasChunkMetaArtifactsSync(dir);
  return !hasChunkMeta(codeDir) || !hasChunkMeta(proseDir);
};

export const needsSqliteArtifacts = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
  return !fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath);
};
