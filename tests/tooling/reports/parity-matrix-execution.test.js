#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parity-matrix-execution-')));
const repo = path.join(temp, 'repo');
const out = path.join(temp, 'matrix');
const queries = path.join(temp, 'queries.txt');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'cache.js'), 'export function refreshCache(value) { return value; }\n');
await fs.writeFile(path.join(repo, 'README.md'), '# Refresh cache\nRefresh cached values.\n');
await fs.writeFile(queries, 'refreshCache\n');
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
  threads: 1,
  indexing: {
    scm: { provider: 'none' }, workerPool: { enabled: false },
    embeddings: { enabled: false, mode: 'off', hnsw: { enabled: false }, lancedb: { enabled: false } },
    typeInference: false, typeInferenceCrossFile: false,
    riskAnalysis: false, riskAnalysisCrossFile: false
  },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
}));
const env = applyTestEnv({
  syncProcess: false, cacheRoot: path.join(temp, 'cache'), embeddings: 'off',
  extraEnv: { PAIROFCLEATS_THREADS: '1', PAIROFCLEATS_BUNDLE_THREADS: '1' }
});
const args = [path.join(root, 'bin', 'pairofcleats.js'), 'report', 'parity',
  '--repo', repo, '--backends', 'sqlite', '--ann-modes', 'off', '--queries', queries, '--out-dir', out];
const readMatrix = () => fs.readFile(path.join(out, 'matrix.json'), 'utf8').then(JSON.parse);

try {
  const build = runNode([path.join(root, 'bin', 'pairofcleats.js'), 'index', 'build',
    '--repo', repo, '--mode', 'both', '--threads', '1'], 'parity fixture build', repo, env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 15000 });
  assert.equal(build.status, 0, `${build.error?.code || ''} ${build.signal || ''}\n${build.stderr}`);
  assert.doesNotMatch(build.stderr, /Worker pool enabled/, 'the fixture explicitly disables worker pools');

  const success = runNode(args, 'parity matrix success from unrelated directory', temp, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 15000 });
  assert.equal(success.status, 0, `${success.error?.code || ''} ${success.signal || ''}\n${success.stderr}`);
  const matrix = await readMatrix();
  assert.equal(matrix.results.length, 1);
  assert.equal(matrix.results[0].status, 'ok', success.stderr);
  assert.equal(matrix.results[0].summary.queries, 1);
  const report = JSON.parse(await fs.readFile(matrix.results[0].outFile, 'utf8'));
  assert.equal(report.results.length, 1);
  assert.equal(report.summary.sqliteBackend, 'sqlite');
  assert.equal(report.summary.annEnabled, false);

  console.log('Parity matrix executes its current child and validates a fresh real report.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
