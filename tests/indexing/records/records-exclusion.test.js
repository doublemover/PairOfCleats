#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadChunkMeta, readJsonFile } from '../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'records-exclusion');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');
const docsDir = path.join(repoRoot, 'docs');
const logsDir = path.join(repoRoot, 'logs');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(docsDir, { recursive: true });
await fsPromises.mkdir(logsDir, { recursive: true });

await fsPromises.writeFile(path.join(srcDir, 'app.js'), 'export const alpha = 1;\n');
await fsPromises.writeFile(path.join(docsDir, 'readme.md'), '# Readme\n');
await fsPromises.writeFile(path.join(logsDir, 'build.log'), '2024-01-01 12:00:00 service startup completed alpha bravo\n');

const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'all', '--stub-embeddings'],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('records exclusion test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
const extractedDir = getIndexDir(repoRoot, 'extracted-prose', userConfig);
const recordsDir = getIndexDir(repoRoot, 'records', userConfig);

const codeMeta = await loadChunkMeta(codeDir);
const proseMeta = await loadChunkMeta(proseDir);
const extractedMeta = await loadChunkMeta(extractedDir);
const recordsMeta = await loadChunkMeta(recordsDir);

const loadFileMeta = async (dir) => {
  const entries = await readJsonFile(path.join(dir, 'file_meta.json'));
  return new Map(entries.map((entry) => [entry.id, entry.file]));
};

const codeFiles = await loadFileMeta(codeDir);
const proseFiles = await loadFileMeta(proseDir);
const extractedFiles = await loadFileMeta(extractedDir);
const recordsFiles = await loadFileMeta(recordsDir);

const hasLog = (meta, fileMap) => meta.some((chunk) => fileMap.get(chunk.fileId) === 'logs/build.log');
if (hasLog(codeMeta, codeFiles) || hasLog(proseMeta, proseFiles) || hasLog(extractedMeta, extractedFiles)) {
  console.error('records exclusion test failed: records file leaked into non-records index.');
  process.exit(1);
}
if (!hasLog(recordsMeta, recordsFiles)) {
  console.error('records exclusion test failed: records file missing from records index.');
  process.exit(1);
}

console.log('records exclusion test passed.');

