#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

const tempRoot = await makeTempDir('poc-scm-git-provider-');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const runGit = (args, label) => {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

try {
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  runGit(['init'], 'git init');
  runGit(['config', 'user.email', 'alpha@example.com'], 'git config email');
  runGit(['config', 'user.name', 'Alpha Author'], 'git config name');

  const trackedFile = path.join(repoRoot, 'tracked.js');
  const untrackedFile = path.join(repoRoot, 'untracked.js');
  await fsPromises.writeFile(trackedFile, 'export const alpha = 1;\n');
  await fsPromises.writeFile(untrackedFile, 'export const beta = 2;\n');
  runGit(['add', 'tracked.js'], 'git add tracked');
  runGit(['commit', '-m', 'init'], 'git commit');

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        scm: { provider: 'git' }
      }
    }
  });
  const buildResult = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'build_index.js'),
      '--stub-embeddings',
      '--no-scm-annotate',
      '--repo',
      repoRoot,
      '--mode',
      'code'
    ],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (buildResult.status !== 0) {
    console.error('git provider build test failed: build_index failed');
    process.exit(buildResult.status ?? 1);
  }

  const userConfig = loadUserConfig(repoRoot);
  const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
  assert(buildInfo?.buildRoot, 'expected current build info');
  const buildState = JSON.parse(
    await fsPromises.readFile(path.join(buildInfo.buildRoot, 'build_state.json'), 'utf8')
  );
  assert.equal(buildState?.repo?.provider, 'git');

  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const fileMetaResult = await loadJsonArrayArtifact(codeDir, 'file_meta');
  const fileMeta = Array.isArray(fileMetaResult?.records)
    ? fileMetaResult.records
    : (Array.isArray(fileMetaResult) ? fileMetaResult : []);
  const files = new Set(fileMeta.map((entry) => entry?.file).filter(Boolean));
  assert(files.has('tracked.js'), 'expected tracked.js to be indexed');
  assert(!files.has('untracked.js'), 'expected untracked.js to be excluded from SCM discovery');

  const chunkMetaResult = await loadJsonArrayArtifact(codeDir, 'chunk_meta');
  const chunkMeta = Array.isArray(chunkMetaResult?.records)
    ? chunkMetaResult.records
    : (Array.isArray(chunkMetaResult) ? chunkMetaResult : []);
  const hasChunkAuthors = chunkMeta.some((entry) => entry?.chunk_authors || entry?.chunkAuthors);
  assert.equal(hasChunkAuthors, false, 'expected no chunk authors when SCM annotate is disabled');
} finally {
  await rmDirRecursive(tempRoot);
}

console.log('git provider build ok');
