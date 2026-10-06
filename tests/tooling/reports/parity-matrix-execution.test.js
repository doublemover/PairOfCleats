#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parity-matrix-execution-'));
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
  '--backends', 'sqlite', '--ann-modes', 'off', '--queries', queries, '--out-dir', out];
const readMatrix = () => fs.readFile(path.join(out, 'matrix.json'), 'utf8').then(JSON.parse);

try {
  const build = runNode([path.join(root, 'bin', 'pairofcleats.js'), 'index', 'build',
    '--repo', repo, '--mode', 'all', '--threads', '1'], 'parity fixture build', repo, env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(build.status, 0, build.stderr);

  const success = runNode(args, 'parity matrix success', repo, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(success.status, 0, success.stderr);
  const matrix = await readMatrix();
  assert.equal(matrix.results.length, 1);
  assert.equal(matrix.results[0].status, 'ok', success.stderr);
  assert.equal(matrix.results[0].summary.queries, 1);
  const report = JSON.parse(await fs.readFile(matrix.results[0].outFile, 'utf8'));
  assert.equal(report.results.length, 1);
  assert.equal(report.summary.sqliteBackend, 'sqlite');
  assert.equal(report.summary.annEnabled, false);

  const failed = runNode([...args, '--search', path.join(temp, 'missing-search.js')],
    'parity matrix failed child', repo, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(failed.status, 1, 'a failed parity child must make the matrix command fail');
  const failedMatrix = await readMatrix();
  assert.equal(failedMatrix.results[0].status, 'failed');
  assert.notEqual(failedMatrix.results[0].exitCode, 0);

  // A zero-exit child that publishes no report must not reuse a prior report.
  await fs.writeFile(matrix.results[0].outFile, JSON.stringify(report));
  const shim = path.join(temp, 'no-report.mjs');
  await fs.writeFile(shim, [
    "import childProcess from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const original = childProcess.spawn;',
    'childProcess.spawn = function(command, args, options) {',
    "  if (String(args?.[0] || '').endsWith('equivalence.test.js')) {",
    "    return original(command, ['-e', 'process.exit(0)'], options);",
    '  }',
    '  return original(command, args, options);',
    '};',
    'syncBuiltinESMExports();'
  ].join('\n'));
  const missingReport = runNode(args, 'parity matrix missing report', repo, {
    ...env, NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --import=${pathToFileURL(shim).href}`.trim()
  }, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(missingReport.status, 1);
  const missingMatrix = await readMatrix();
  assert.equal(missingMatrix.results[0].status, 'failed');
  assert.match(missingMatrix.results[0].error, /report/i);
  await assert.rejects(fs.access(matrix.results[0].outFile));
  console.log('Parity matrix executes its current child, validates fresh reports and propagates failures.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
