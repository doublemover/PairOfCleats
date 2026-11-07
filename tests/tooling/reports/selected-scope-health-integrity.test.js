import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBaseIndex, defaultUserConfig } from '../../indexing/validate/helpers.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { captureIndexStatusPlan } from '../../../src/integrations/core/status-plan.js';
import { getStatus } from '../../../src/integrations/core/status.js';
import { createCli } from '../../../src/shared/cli.js';
import { INDEX_BUILD_OPTIONS } from '../../../src/shared/cli-options.js';
import { LMDB_BUILD_OPTIONS } from '../../../tools/shared/operator-cli-options.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { SQLITE_ZERO_STATE_SCHEMA_VERSION, sqliteZeroStateChecksum, resolveSqliteZeroStateSourceProof } from '../../../src/storage/sqlite/zero-state.js';

const { dir } = await prepareIsolatedTestCacheDir('selected-scope-health-integrity');
const repo = path.join(dir, "selected A &'雪"), elsewhere = path.join(dir, 'unrelated B');
await fs.mkdir(repo); await fs.mkdir(elsewhere);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  testConfig: { indexing: { scm: { provider: 'none' } }, tooling: { autoEnableOnDetect: false },
    sqlite: defaultUserConfig.sqlite, lmdb: defaultUserConfig.lmdb },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const config = loadUserConfig(repo), cache = getRepoCacheRoot(repo, config), builds = path.join(cache, 'builds');
const pointerPath = path.join(builds, 'current.json');
const write = (file, value) => fs.writeFile(file, JSON.stringify(value));
const make = async (id, mode, sqlite = null, lmdb = null, empty = false) => {
  const fixture = await createBaseIndex({ rootDir: path.join(dir, id), indexState: {
    mode, generatedAt: '2026-10-29T00:00:00Z', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    ...(sqlite ? { sqlite } : {}), ...(lmdb ? { lmdb } : {}) },
  ...(empty ? { chunkMeta: [], tokenPostings: { vocab: [], postings: [], docLengths: [], avgDocLen: 0, totalDocs: 0 } } : {}) });
  const root = path.join(builds, id), target = path.join(root, `index-${mode}`);
  await fs.mkdir(root, { recursive: true }); await fs.cp(fixture.indexDir, target, { recursive: true });
  await write(path.join(target, 'repo_map.json'), [{ file: 'src/a.js', name: id, kind: 'Function' }]);
  const manifestPath = path.join(target, 'pieces/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath));
  manifest.pieces.push({ name: 'repo_map', type: 'chunks', path: 'repo_map.json', format: 'json', count: 1 });
  await write(manifestPath, manifest);
  await write(path.join(root, 'build_state.json'), { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    modes: [mode], counts: { [mode]: { files: 1, chunks: id === 'unpromoted' ? 999 : 1 } } });
  return { root, target };
};
const publish = roots => write(pointerPath, { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  buildId: 'selected', buildRoot: Object.values(roots)[0], buildRootsByMode: roots,
  modes: Object.keys(roots), promotedAt: '2026-10-29T00:00:00Z' });
const report = async () => {
  const result = await spawnSubprocess(process.execPath, [path.resolve('tools/index/report-artifacts.js'), '--repo', repo, '--json'],
    { cwd: elsewhere, env, timeoutMs: 10000, maxOutputBytes: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.exitCode, 0, result.stderr); return JSON.parse(result.stdout);
};
try {
  const code = await make('code-published', 'code'); await publish({ code: code.root });
  await make('unpromoted', 'code');
  const healthy = await report();
  assert.deepEqual(Object.keys(healthy.corruption.modes), ['code']);
  assert.equal(healthy.corruption.ok, true, JSON.stringify(healthy.corruption.issues));
  assert.deepEqual(healthy.health.issues, []); assert.deepEqual(healthy.health.repairActions, []);
  assert.equal(healthy.corruption.sqlite.enabled, false); assert.equal(healthy.corruption.lmdb.enabled, false);
  assert.equal(healthy.analysis.modes.code.chunks, 1, 'unpromoted later directories cannot supply published analysis');
  const plan = captureIndexStatusPlan({ root: repo, userConfig: config });
  const prose = await make('prose-retained', 'prose'); await publish({ prose: prose.root });
  const pinned = await getStatus({ repoRoot: repo, userConfig: config, plan });
  assert.deepEqual(Object.keys(pinned.corruption.modes), ['code']);
  assert.equal(path.relative(pinned.corruption.selection.roots.code, code.root), '', 'one operation does not recapture a changed publication');
  await publish({ code: code.root, prose: prose.root });
  const mixed = await report();
  assert.deepEqual(Object.keys(mixed.corruption.modes), ['code', 'prose']); assert.equal(mixed.corruption.ok, true);
  assert.equal(mixed.analysis.buildRoot, null); assert.equal(mixed.analysis.modes.code.chunks, 1);
  await fs.rm(path.join(code.target, 'chunk_meta.json'));
  const broken = await report();
  assert.equal(broken.corruption.ok, false); assert.equal(broken.corruption.modes.code.ok, false);
  assert.equal(broken.corruption.modes.prose.ok, true); assert.ok(broken.health.issues.length);
  const action = broken.health.repairActions.find(value => value.backend === 'files');
  assert.equal(path.relative(action.repository, repo), ''); assert.deepEqual(action.modes, ['code']);
  const parsed = createCli({ scriptName: 'selected-repair', argv: [process.execPath, 'build-index', ...action.argv.slice(2)], options: INDEX_BUILD_OPTIONS }).parse();
  assert.equal(path.relative(parsed.repo, repo), ''); assert.equal(parsed.mode, 'code'); assert.equal(parsed.sqlite, false);
  assert.ok(action.command.toLowerCase().includes(repo.replaceAll("'", "''").toLowerCase())); assert.equal(action.cwd, null);
  const required = await make('sqlite-required', 'code', { status: 'ready' });
  await publish({ code: required.root });
  const missing = await report();
  assert.equal(missing.corruption.ok, false); assert.equal(missing.corruption.sqlite.ok, false);
  assert.ok(missing.health.repairActions.some(value => value.backend === 'sqlite' && value.modes[0] === 'code'));
  const requiredPlan = captureIndexStatusPlan({ root: repo, userConfig: config });
  const sqlitePath = requiredPlan.validationSelection.sqlitePaths.code;
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true }); await fs.writeFile(sqlitePath, 'not a SQLite database');
  const requiredProse = await make('sqlite-required-prose', 'prose', { status: 'ready' });
  await publish({ code: required.root, prose: requiredProse.root });
  const corrupt = await report(); assert.equal(corrupt.corruption.ok, false); assert.equal(corrupt.corruption.sqlite.ok, false);
  assert.ok(corrupt.health.repairActions.some(value => value.backend === 'sqlite'));
  assert.ok(corrupt.corruption.findings.some(value => value.capability === 'sqlite' && value.code === 'SQLITE_NOTADB'));
  assert.ok(corrupt.corruption.findings.some(value => value.capability === 'sqlite' && value.mode === 'prose' && value.state === 'missing'),
    'one missing mode cannot suppress actual database validation of another selected mode');
  for (const mode of ['code', 'prose', 'records', 'extracted-prose']) {
    const zero = await make(`zero-${mode}`, mode, { status: 'ready' }, null, true); await publish({ [mode]: zero.root });
    const zeroPlan = captureIndexStatusPlan({ root: repo, userConfig: config });
    const body = { schemaVersion: SQLITE_ZERO_STATE_SCHEMA_VERSION, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      mode, indexDir: path.resolve(zero.target), outputPath: zeroPlan.validationSelection.sqlitePaths[mode],
      chunkCount: 0, denseCount: 0, sourceProof: await resolveSqliteZeroStateSourceProof(zero.target, mode) };
    await write(path.join(zero.target, 'pieces/sqlite-zero-state.json'), { ...body, checksum: sqliteZeroStateChecksum(body) });
    const validZero = await getStatus({ repoRoot: repo, userConfig: config });
    assert.equal(validZero.corruption.ok, true, JSON.stringify(validZero.corruption.issues));
    assert.deepEqual(validZero.corruption.sqlite.zeroStateModes, [mode]);
    assert.equal(validZero.health.backends.sqlite[mode].status, 'zero-state'); assert.deepEqual(validZero.health.issues, []);
  }
  const lmdb = await make('lmdb-required', 'prose', null, { status: 'ready' });
  const latestCode = await make('lmdb-unselected-code', 'code');
  await publish({ code: latestCode.root, prose: lmdb.root });
  const missingLmdb = await report(); assert.equal(missingLmdb.corruption.ok, false);
  assert.equal(missingLmdb.corruption.lmdb.ok, false);
  const lmdbAction = missingLmdb.health.repairActions.find(value => value.backend === 'lmdb' && value.modes[0] === 'prose');
  assert.ok(lmdbAction);
  const lmdbArgs = createCli({ scriptName: 'selected-lmdb-repair',
    argv: [process.execPath, 'lmdb-index', ...lmdbAction.argv.slice(2)], options: LMDB_BUILD_OPTIONS }).parse();
  assert.equal(path.relative(lmdbArgs.repo, repo), ''); assert.equal(lmdbArgs.mode, 'prose');
  assert.equal(path.relative(lmdbArgs['index-root'], lmdb.root), '', 'canonical LMDB argv retains the older prose generation instead of latest code');
  assert.equal(path.relative(lmdbAction.observedIndexRoot, lmdb.root), '');
  const omitted = await make('sqlite-disabled-lmdb-omitted', 'code', { status: 'disabled' }); await publish({ code: omitted.root });
  const disabled = await report(); assert.equal(disabled.corruption.ok, true); assert.deepEqual(disabled.health.issues, []);
  assert.equal(disabled.health.backends.sqlite.code.status, 'disabled'); assert.equal(disabled.corruption.lmdb.enabled, false);
  await write(pointerPath, { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'none', buildRoot: code.root,
    buildRootsByMode: {}, modes: [], promotedAt: '2026-10-29T00:00:00Z' });
  const empty = await report(); assert.equal(empty.corruption.ok, false); assert.ok(empty.health.issues.length);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Normal artifact report and status share captured mode/backend scope, published analysis and target-preserving repair actions.');
