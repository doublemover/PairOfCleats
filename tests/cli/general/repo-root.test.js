#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureGitAvailableOrSkip, initGitRepo, runGit } from '../../helpers/git-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

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

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  },
  syncProcess: false
});

runNode(
  [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--stage',
    'stage1',
    '--mode',
    'code',
    '--scm-provider',
    'none'
  ],
  'build_index repo-root fixture',
  repoRoot,
  env
);

const searchPath = path.join(root, 'search.js');
function runSearch(cwd) {
  const result = runNode(
    [searchPath, 'return', '--mode', 'code', '--json', '--no-ann'],
    `search repo-root fixture cwd=${cwd}`,
    cwd,
    env,
    { stdio: 'pipe' }
  );
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

