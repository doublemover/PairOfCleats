import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../../shared/cli-utils.js';
import { getIndexDir, getRepoCacheRoot, loadUserConfig, resolveSqlitePaths } from '../../shared/dict-utils.js';
import { emitBenchLog } from './logging.js';

const canRun = (cmd, args) => {
  try {
    const result = runCommand(cmd, args, { encoding: 'utf8' });
    return result.ok;
  } catch {
    return false;
  }
};
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 120000;

export const buildNonInteractiveGitEnv = (baseEnv = process.env) => ({
  ...baseEnv,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'Never'
});

const runGitInRepo = (repoPath, args, { timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS } = {}) => {
  return runCommand('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: buildNonInteractiveGitEnv()
  });
};

const firstOutputLine = (result) => {
  const text = String(result?.stderr || result?.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return text || 'no output';
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
    gitRepo: false,
    submodules: {
      detected: 0,
      missing: 0,
      dirty: 0,
      updated: false
    },
    lfs: {
      supported: false,
      tracked: 0,
      pulled: false
    }
  };
  if (!repoPath || !fs.existsSync(repoPath)) return summary;
  if (!canRun('git', ['--version'])) return summary;

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
      log(
        `[repo-preflight] failed to inspect submodules for ${repoPath}: ${firstOutputLine(statusResult)}`,
        'warn'
      );
    } else {
      const entries = parseSubmoduleStatusLines(statusResult.stdout);
      summary.submodules.detected = entries.length;
      summary.submodules.missing = entries.filter((entry) => entry.missing).length;
      summary.submodules.dirty = entries.filter((entry) => entry.dirty).length;
      if (summary.submodules.missing > 0 || summary.submodules.dirty > 0) {
        runGitInRepo(repoPath, ['submodule', 'sync', '--recursive'], {
          timeoutMs: Math.min(preflightTimeoutMs, 45000)
        });
        const updateResult = runGitInRepo(
          repoPath,
          ['submodule', 'update', '--init', '--recursive', '--jobs', '8'],
          { timeoutMs: preflightTimeoutMs }
        );
        if (!updateResult.ok) {
          log(
            `[repo-preflight] submodule init failed for ${repoPath}: ${firstOutputLine(updateResult)}`,
            'warn'
          );
        } else {
          summary.submodules.updated = true;
          log(
            `[repo-preflight] submodules ready for ${repoPath} ` +
            `(missing=${summary.submodules.missing}, dirty=${summary.submodules.dirty}).`
          );
        }
      }
    }
  }

  if (pullLfs) {
    const lfsVersion = runCommand('git', ['lfs', 'version'], {
      encoding: 'utf8',
      timeout: Math.min(preflightTimeoutMs, 15000)
    });
    if (lfsVersion.ok) {
      summary.lfs.supported = true;
      const lfsFiles = runGitInRepo(repoPath, ['lfs', 'ls-files', '--name-only'], {
        timeoutMs: preflightTimeoutMs
      });
      if (!lfsFiles.ok) {
        log(`[repo-preflight] git-lfs scan failed for ${repoPath}: ${firstOutputLine(lfsFiles)}`, 'warn');
      } else {
        const tracked = String(lfsFiles.stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        summary.lfs.tracked = tracked.length;
        if (tracked.length > 0) {
          const pullResult = runGitInRepo(repoPath, ['lfs', 'pull'], { timeoutMs: preflightTimeoutMs });
          if (!pullResult.ok) {
            log(`[repo-preflight] git-lfs pull failed for ${repoPath}: ${firstOutputLine(pullResult)}`, 'warn');
          } else {
            summary.lfs.pulled = true;
            log(`[repo-preflight] git-lfs ready for ${repoPath} (${tracked.length} tracked file(s)).`);
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
      buildArgs: (repo, repoPath) => ['repo', 'clone', repo, repoPath]
    };
  }
  if (gitAvailable) {
    return {
      label: 'git',
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

export const needsIndexArtifacts = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
  const hasChunkMeta = (dir) => (
    fs.existsSync(path.join(dir, 'chunk_meta.json'))
    || fs.existsSync(path.join(dir, 'chunk_meta.jsonl'))
    || fs.existsSync(path.join(dir, 'chunk_meta.meta.json'))
    || fs.existsSync(path.join(dir, 'chunk_meta.parts'))
  );
  return !hasChunkMeta(codeDir) || !hasChunkMeta(proseDir);
};

export const needsSqliteArtifacts = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
  return !fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath);
};
