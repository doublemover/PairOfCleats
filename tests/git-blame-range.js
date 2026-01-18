#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { loadChunkMeta } from '../src/shared/artifact-io.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'git-blame-range');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
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
runGit(['config', 'user.email', 'alpha@example.com'], 'git config email alpha');
runGit(['config', 'user.name', 'Alpha Author'], 'git config name alpha');

const sourcePath = path.join(repoRoot, 'sample.js');
await fsPromises.writeFile(
  sourcePath,
  ['function alpha() {', '  return 1;', '}'].join('\n') + '\n'
);
runGit(['add', '.'], 'git add alpha');
runGit(['commit', '-m', 'alpha'], 'git commit alpha');

runGit(['config', 'user.email', 'beta@example.com'], 'git config email beta');
runGit(['config', 'user.name', 'Beta Author'], 'git config name beta');
await fsPromises.appendFile(
  sourcePath,
  ['','function beta() {', '  return 2;', '}'].join('\n') + '\n'
);
runGit(['add', '.'], 'git add beta');
runGit(['commit', '-m', 'beta'], 'git commit beta');

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('git blame range test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const meta = await loadChunkMeta(codeDir);

const findChunkByName = (name) =>
  meta.find((chunk) => chunk.name === name || String(chunk.name || '').includes(name));
const findChunkByRange = (startLine, endLine) =>
  meta.find((chunk) => chunk.startLine === startLine && chunk.endLine === endLine);

const alphaChunk = findChunkByRange(1, 3) || findChunkByName('alpha');
const betaChunk = meta.find((chunk) => Number(chunk.startLine) >= 4)
  || findChunkByName('beta');
if (!alphaChunk || !betaChunk) {
  console.error('Expected alpha and beta chunks in chunk_meta.json');
  process.exit(1);
}
const alphaAuthors = new Set(alphaChunk.chunk_authors || []);
const betaAuthors = new Set(betaChunk.chunk_authors || []);
if (alphaChunk.startLine !== 1 || alphaChunk.endLine !== 3) {
  console.error(`Expected alpha chunk line range 1-3, got ${alphaChunk.startLine}-${alphaChunk.endLine}`);
  process.exit(1);
}
if (!Number.isFinite(betaChunk.startLine) || betaChunk.startLine < 4) {
  console.error(`Expected beta chunk start line >= 4, got ${betaChunk.startLine}`);
  process.exit(1);
}
if (!alphaAuthors.has('Alpha Author')) {
  console.error(`Expected Alpha Author in alpha chunk authors, got ${Array.from(alphaAuthors).join(', ')}`);
  process.exit(1);
}
if (!betaAuthors.has('Beta Author')) {
  console.error(`Expected Beta Author in beta chunk authors, got ${Array.from(betaAuthors).join(', ')}`);
  process.exit(1);
}
if (alphaAuthors.has('Beta Author')) {
  console.error('Unexpected Beta Author in alpha chunk authors (range likely wrong).');
  process.exit(1);
}
if (betaAuthors.has('Alpha Author')) {
  console.error('Unexpected Alpha Author in beta chunk authors (range likely wrong).');
  process.exit(1);
}

console.log('Git blame range test passed');
