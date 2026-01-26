#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'repo-root');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const nestedDir = path.join(repoRoot, 'nested');

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(nestedDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const runGit = (args, label) => {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

runGit(['init'], 'git init');
runGit(['config', 'user.email', 'test@example.com'], 'git config email');
runGit(['config', 'user.name', 'Test User'], 'git config name');

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

runGit(['add', '.'], 'git add');
runGit(['commit', '-m', 'init'], 'git commit');

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

