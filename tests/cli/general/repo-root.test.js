#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureGitAvailableOrSkip, initGitRepo, runGit } from '../../helpers/git-fixture.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const { dir: tempRoot } = await prepareTestCacheDir('repo-root');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const nestedDir = path.join(repoRoot, 'nested');

if (!ensureGitAvailableOrSkip()) {
  process.exit(0);
}

await fsPromises.mkdir(nestedDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

initGitRepo(repoRoot);

const sourcePath = path.join(nestedDir, 'example.js');
await fsPromises.writeFile(
  sourcePath,
  [
    'function greet(name) {',
    '  return `hello ${name}`;',
    '}',
    ''
  ].join('\n')
);

runGit(['add', '.'], { cwd: repoRoot, label: 'git add' });
runGit(['commit', '-m', 'init'], { cwd: repoRoot, label: 'git commit' });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings'],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

const searchPath = path.join(root, 'search.js');
function runSearch(cwd) {
  const result = spawnSync(
    process.execPath,
    [searchPath, 'return', '--mode', 'code', '--json', '--no-ann'],
    { cwd, env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`Failed: search (cwd=${cwd})`);
    console.error(result.stderr || result.stdout || '');
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
}

const rootPayload = runSearch(repoRoot);
const nestedPayload = runSearch(nestedDir);
const rootHits = rootPayload.code || [];
const nestedHits = nestedPayload.code || [];
if (!rootHits.length || !nestedHits.length) {
  console.error('Repo root test returned no results.');
  process.exit(1);
}

const rootIds = rootHits.map((hit) => hit.id);
const nestedIds = nestedHits.map((hit) => hit.id);
if (JSON.stringify(rootIds) !== JSON.stringify(nestedIds)) {
  console.error('Repo root test results differ between root and subdir.');
  process.exit(1);
}

console.log('Repo root resolution test passed');

