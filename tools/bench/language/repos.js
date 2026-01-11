import fs from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { getIndexDir, getRepoCacheRoot, loadUserConfig, resolveSqlitePaths } from '../../dict-utils.js';

const canRun = (cmd, args) => {
  try {
    const result = execaSync(cmd, args, { encoding: 'utf8', reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

export const resolveCloneTool = () => {
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
  console.error('GitHub CLI (gh) or git is required to clone benchmark repos.');
  process.exit(1);
};

export const ensureLongPathsSupport = () => {
  if (process.platform !== 'win32') return;
  if (canRun('git', ['--version'])) {
    try {
      execaSync('git', ['config', '--global', 'core.longpaths', 'true'], { stdio: 'ignore', reject: false });
    } catch {}
  }
  let regResult;
  try {
    regResult = execaSync(
      'reg',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'],
      { encoding: 'utf8', reject: false }
    );
  } catch {
    regResult = null;
  }
  if (!regResult || regResult.exitCode !== 0) {
    console.warn('Warning: Unable to confirm Windows long path setting. Enable LongPathsEnabled=1 if clones fail.');
    return;
  }
  const match = String(regResult.stdout || '').match(/LongPathsEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i);
  if (!match) return;
  const value = Number.parseInt(match[1], 16);
  if (value === 0) {
    console.warn('Warning: Windows long paths are disabled. Enable LongPathsEnabled=1 to avoid clone failures.');
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
