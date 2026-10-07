#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

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
  testConfig: createFastIndexingTestConfig(),
  extraEnv: { PAIROFCLEATS_THREADS: '1', PAIROFCLEATS_BUNDLE_THREADS: '1' }
});
const args = [path.join(root, 'bin', 'pairofcleats.js'), 'report', 'parity',
  '--repo', repo, '--backends', 'sqlite', '--ann-modes', 'off', '--queries', queries, '--out-dir', out];
const readMatrix = () => fs.readFile(path.join(out, 'matrix.json'), 'utf8').then(JSON.parse);
const executionDeadline = Date.now() + 26000;
const runNode = async (args, label, cwd, childEnv = env) => {
  try {
    return await spawnSubprocess(process.execPath, args, {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeoutMs: Math.max(1, Math.min(20000, executionDeadline - Date.now())),
      rejectOnNonZeroExit: false
    });
  } catch (error) {
    error.message = `${label}: ${error.message}\n${error.result?.stderr || ''}`;
    throw error;
  }
};
let executionError;

try {
  // This reports contract needs real searchable artifacts, not full enrichment
  // or the records mode. Keep setup in an owned, deadline-bound child.
  const buildModule = pathToFileURL(path.join(root, 'src/integrations/core/build-index/index.js')).href;
  const sqliteModule = pathToFileURL(path.join(root, 'tests/helpers/sqlite-builder.js')).href;
  const buildScript = `import { buildIndex } from ${JSON.stringify(buildModule)};
    import { runSqliteBuild } from ${JSON.stringify(sqliteModule)};
    await buildIndex(${JSON.stringify(repo)}, { stage: 'stage1', modes: ['code', 'prose', 'extracted-prose'], threads: 1 });
    for (const mode of ['code', 'prose', 'extracted-prose']) {
      await runSqliteBuild(${JSON.stringify(repo)}, { mode });
    }`;
  const build = await runNode(['--input-type=module', '--eval', buildScript], 'parity fixture build', repo);
  assert.equal(build.exitCode, 0, `${build.signal || ''}\n${build.stderr}`);
  assert.doesNotMatch(build.stderr, /Worker pool enabled/, 'the fixture explicitly disables worker pools');

  // Ready indexes must not load the indexing pipeline in the report child.
  const importGuard = path.join(temp, 'parity-import-guard.mjs');
  const sqliteBuilderUrl = pathToFileURL(path.join(root, 'tests/helpers/sqlite-builder.js')).href;
  await fs.writeFile(importGuard, `
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, nextLoad) {
      if (url === ${JSON.stringify(sqliteBuilderUrl)}) {
        throw new Error('Ready-index parity must not load the SQLite build pipeline');
      }
      return nextLoad(url, context);
    } });
  `);
  const success = await runNode(args, 'parity matrix success from unrelated directory', temp, {
    ...env, NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --import=${pathToFileURL(importGuard).href}`.trim()
  });
  assert.equal(success.exitCode, 0, `${success.signal || ''}\n${success.stderr}`);
  const matrix = await readMatrix();
  assert.equal(matrix.results.length, 1);
  assert.equal(matrix.results[0].status, 'ok', success.stderr);
  assert.equal(matrix.results[0].summary.queries, 1);
  const report = JSON.parse(await fs.readFile(matrix.results[0].outFile, 'utf8'));
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].query, 'refreshCache');
  assert.ok(report.results[0].code.topMemory.length > 0, 'the real memory search must return hits');
  assert.ok(report.results[0].code.topSqlite.length > 0, 'the real SQLite search must return hits');
  assert.equal(report.results[0].code.overlap, 1, 'the real backends must agree on the fixture hits');
  assert.equal(report.summary.sqliteBackend, 'sqlite');
  assert.equal(report.summary.annEnabled, false);

  console.log('Parity matrix executes its current child and validates a fresh real report.');
} catch (error) {
  executionError = error;
  throw error;
} finally {
  try {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  } catch (cleanupError) {
    // Preserve the child failure if Windows still holds a transient directory
    // handle. A cleanup failure must never replace the useful original error.
    if (executionError) {
      throw new AggregateError([executionError, cleanupError], executionError.message);
    }
    throw cleanupError;
  }
}
