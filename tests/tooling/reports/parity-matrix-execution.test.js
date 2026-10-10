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
  // Seed canonical nonempty artifacts with the shared fixture writer, then build
  // actual SQLite databases. Report execution still runs its real child and both
  // search backends; parser/index-build acceptance belongs to indexing tests.
  const fixtureModule = pathToFileURL(path.join(root, 'tests/indexing/validate/helpers.js')).href;
  const pathsModule = pathToFileURL(path.join(root, 'tools/shared/dict-utils.js')).href;
  const sqliteModule = pathToFileURL(path.join(root, 'tests/helpers/sqlite-builder.js')).href;
  const versionModule = pathToFileURL(path.join(root, 'src/contracts/versioning.js')).href;
  const buildScript = `import fs from 'node:fs/promises';
    import path from 'node:path';
    import { createBaseIndex } from ${JSON.stringify(fixtureModule)};
    import { getRepoCacheRoot, loadUserConfig } from ${JSON.stringify(pathsModule)};
    import { runSqliteBuild } from ${JSON.stringify(sqliteModule)};
    import { ARTIFACT_SURFACE_VERSION } from ${JSON.stringify(versionModule)};
    const repo = ${JSON.stringify(repo)};
    const cache = getRepoCacheRoot(repo, loadUserConfig(repo));
    const buildId = 'parity-fixture';
    const buildRoot = path.join(cache, 'builds', buildId);
    await fs.mkdir(buildRoot, { recursive: true });
    const roots = {};
    for (const mode of ['code', 'prose', 'extracted-prose']) {
      const empty = mode === 'extracted-prose';
      const file = mode === 'code' ? 'cache.js' : 'README.md';
      const { indexDir } = await createBaseIndex({ semantic: true, rootDir: path.join(buildRoot, mode),
        chunkMeta: empty ? [] : [{ id: 0, file, start: 0, end: 14, startLine: 1, endLine: 1,
          name: 'refreshCache', kind: mode, metaV2: {}, tokens: ['cache', 'refresh', 'refreshcache'] }],
        tokenPostings: { vocab: empty ? [] : ['cache', 'refresh', 'refreshcache'],
          postings: empty ? [] : [[[0,1]], [[0,1]], [[0,1]]],
          docLengths: empty ? [] : [3], avgDocLen: empty ? 0 : 3, totalDocs: empty ? 0 : 1 },
        indexState: { buildId, generatedAt: new Date().toISOString(), mode, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
          compatibilityKey: 'parity-fixture-v1' },
        manifestOverrides: { mode, compatibilityKey: 'parity-fixture-v1' }
      });
      await fs.writeFile(path.join(indexDir, 'chunk_meta.meta.json'), JSON.stringify({ totalRecords: empty ? 0 : 1 }));
      await fs.rename(indexDir, path.join(buildRoot, 'index-' + mode));
      roots[mode] = 'builds/' + buildId;
    }
    await fs.writeFile(path.join(buildRoot, 'build_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, schemaVersion: 1, signatureVersion: 2,
      buildId, configHash: 'parity-fixture', tool: { version: '1.0.0' },
      validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] } }));
    await fs.writeFile(path.join(cache, 'builds/current.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId,
      buildRoot: 'builds/' + buildId, buildRoots: roots }));
    for (const mode of Object.keys(roots)) await runSqliteBuild(repo, { mode });`;
  const build = await runNode(['--input-type=module', '--eval', buildScript], 'parity fixture artifacts', repo);
  assert.equal(build.exitCode, 0, `${build.signal || ''}\n${build.stderr}`);

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
