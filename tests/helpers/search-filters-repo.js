import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getIndexDir, loadUserConfig } from '../../tools/dict-utils.js';
import { syncProcessEnv } from './test-env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const runGit = (args, label, cwd, envOverride = {}) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...envOverride }
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

const hasGit = () => {
  const check = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return check.status === 0;
};

const hasChunkMeta = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
  return fs.existsSync(path.join(codeDir, 'chunk_meta.json'))
    && fs.existsSync(path.join(proseDir, 'chunk_meta.json'));
};

const buildIndex = (repoRoot, env) => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error('Failed: build_index');
    process.exit(result.status ?? 1);
  }
};

export const ensureSearchFiltersRepo = async () => {
  if (!hasGit()) {
    console.log('[skip] git not available');
    return null;
  }
  const tempRoot = path.join(ROOT, '.testCache', 'search-filters');
  const repoRoot = path.join(tempRoot, `repo-${process.pid}`);
  const cacheRoot = path.join(tempRoot, `cache-${process.pid}`);
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    runGit(['init'], 'git init', repoRoot);
    runGit(['config', 'user.email', 'test@example.com'], 'git config email', repoRoot);
    runGit(['config', 'user.name', 'Test User'], 'git config name', repoRoot);

    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const dateOld = new Date(now - 5 * dayMs).toISOString();
    const dateNew = new Date(now - 1 * dayMs).toISOString();

    await fsPromises.writeFile(path.join(repoRoot, 'alpha.txt'), 'alpha beta\nalpha beta\n');
    runGit(['add', '.'], 'git add alpha', repoRoot);
    runGit(
      ['commit', '-m', 'add alpha', '--author', 'Alice <alice@example.com>', '--date', dateOld],
      'git commit alpha',
      repoRoot,
      { GIT_AUTHOR_DATE: dateOld, GIT_COMMITTER_DATE: dateOld }
    );

    await fsPromises.writeFile(path.join(repoRoot, 'beta.txt'), 'alpha gamma\nalpha delta\n');
    runGit(['add', '.'], 'git add beta', repoRoot);
    runGit(
      ['commit', '-m', 'add beta', '--author', 'Bob <bob@example.com>', '--date', dateNew],
      'git commit beta',
      repoRoot,
      { GIT_AUTHOR_DATE: dateNew, GIT_COMMITTER_DATE: dateNew }
    );

    await fsPromises.writeFile(path.join(repoRoot, 'CaseFile.TXT'), 'AlphaCase alpha\n');
    runGit(['add', '.'], 'git add CaseFile', repoRoot);
    runGit(
      ['commit', '-m', 'add case file', '--author', 'Casey <casey@example.com>', '--date', dateNew],
      'git commit CaseFile',
      repoRoot,
      { GIT_AUTHOR_DATE: dateNew, GIT_COMMITTER_DATE: dateNew }
    );

    await fsPromises.writeFile(
      path.join(repoRoot, 'sample.js'),
      'const equal = (a, b) => a && b;\nfunction check(a, b) {\n  return a && b;\n}\n'
    );
    runGit(['add', '.'], 'git add sample.js', repoRoot);
    runGit(
      ['commit', '-m', 'add sample.js', '--author', 'Dana <dana@example.com>', '--date', dateNew],
      'git commit sample.js',
      repoRoot,
      { GIT_AUTHOR_DATE: dateNew, GIT_COMMITTER_DATE: dateNew }
    );
  }

  const env = {
    ...process.env,
    PAIROFCLEATS_TESTING: '1',
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };
  syncProcessEnv(env);

  if (!hasChunkMeta(repoRoot)) {
    buildIndex(repoRoot, env);
  }

  const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const branchName = branchResult.status === 0 ? branchResult.stdout.trim() : null;

  return { root: ROOT, repoRoot, cacheRoot, env, branchName };
};

export const runFilterSearch = ({
  root = ROOT,
  repoRoot,
  env,
  query,
  args = [],
  mode = 'prose',
  backend = 'memory'
}) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'search.js'),
      query,
      '--mode',
      mode,
      '--json',
      '--no-ann',
      '--repo',
      repoRoot,
      ...(backend ? ['--backend', backend] : []),
      ...args
    ],
    { cwd: repoRoot, env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error('Failed: search');
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (err) {
    console.error(`Failed to parse search output: ${err?.message || err}`);
    process.exit(1);
  }
};

