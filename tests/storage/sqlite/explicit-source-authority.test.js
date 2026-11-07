import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createBaseIndex, defaultUserConfig } from '../../indexing/validate/helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildSqliteIndex } from '../../../src/integrations/core/build-index/sqlite.js';
import { resolveModeExecutionPlan } from '../../../src/storage/sqlite/build/runner/mode-plan.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { initBuildState } from '../../../src/index/build/build-state.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('explicit-source-authority/')[1];
assert.ok(['no-current', 'partial-current', 'historical-conflict', 'native-detached', 'native-empty', 'native-external-output', 'native-known-output'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-source-authority-${selected}`);
const root = path.join(dir, 'repo'); await fs.mkdir(root);
const userConfig = { ...defaultUserConfig, cache: { root: path.join(dir, 'cache') } };
const empty = selected === 'native-empty';
const source = await createBaseIndex({ rootDir: path.join(dir, 'source'), semantic: true,
  manifestOverrides: { mode: 'code' }, chunkMeta: empty ? [] : null,
  tokenPostings: empty ? { vocab: [], postings: [], docLengths: [], avgDocLen: 0, totalDocs: 0 } : null });
const out = path.join(dir, 'output.db');
if (selected === 'native-known-output') {
  const manifestPath = path.join(source.indexDir, 'pieces', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.pieces.find(piece => piece.name === 'chunk_meta').count = 1;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
}
const plan = (extra = {}) => resolveModeExecutionPlan({ modeArg: 'code', root, userConfig,
  argv: {}, options: { codeDir: source.indexDir, out }, ...extra });
if (selected === 'no-current') {
  const result = plan(); assert.equal(result.errorMessage, undefined);
  assert.equal(result.modeIndexDirs.code, source.indexDir);
  assert.equal(result.modeStateRoots.code, null, 'detached source cannot mutate an ambient generation');
  const missingOutput = plan({ options: { codeDir: source.indexDir } });
  assert.match(missingOutput.errorMessage, /requires explicit --out/);
  const again = plan(); again.modeStateRoots.code = 'caller mutation';
  assert.equal(plan().modeStateRoots.code, null, 'memoized state authority is not shared with caller mutations');
} else if (selected === 'partial-current') {
  const repoCache = resolveRepoCacheRootPath(root, userConfig), published = path.join(repoCache, 'builds', 'P');
  await fs.mkdir(path.join(published, 'index-prose'), { recursive: true });
  await fs.writeFile(path.join(published, 'index-prose', 'chunk_meta.json'), '[]');
  await fs.writeFile(path.join(repoCache, 'builds', 'current.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'P', buildRoot: 'builds/P', buildRootsByMode: { prose: 'builds/P' }, modes: ['prose'] }));
  const result = plan({ modeArg: 'all', options: { codeDir: source.indexDir, extractedProseDir: source.indexDir,
    recordsDir: source.indexDir, out: path.join(dir, 'outputs') } });
  assert.equal(result.errorMessage, undefined);
  assert.equal(result.modeIndexDirs.code, source.indexDir);
  assert.equal(path.resolve(result.modeIndexDirs.prose).toLowerCase(), path.join(published, 'index-prose').toLowerCase());
  assert.equal(result.modeStateRoots.code, null);
  assert.equal(result.executionGroups.length, 4, 'distinct source selections cannot collapse because outputs share a directory');
} else if (selected === 'historical-conflict') {
  const result = plan({ argv: { snapshot: 'explicit-selector' } });
  assert.match(result.errorMessage, /cannot be combined.*one source authority/);
} else {
  const options = { userConfig, mode: 'code', out, emitOutput: false, validateMode: 'off', logger: { log() {}, warn() {}, error() {} } };
  if (['native-external-output', 'native-known-output'].includes(selected)) options.indexRoot = source.indexRoot;
  else options.codeDir = source.indexDir;
  await initBuildState({ buildRoot: source.indexRoot, buildId: 'source-build', repoRoot: root, modes: ['code'],
    stage: 'stage2', configHash: 'fixture', toolVersion: 'test', repoProvenance: {}, signatureVersion: 2 });
  const buildStatePath = path.join(source.indexRoot, 'build_state.json'), buildStateBefore = await fs.readFile(buildStatePath);
  const statePath = path.join(source.indexDir, 'index_state.json'), manifestPath = path.join(source.indexDir, 'pieces', 'manifest.json');
  const stateBefore = await fs.readFile(statePath), manifestBefore = await fs.readFile(manifestPath);
  const result = await buildSqliteIndex(root, options);
  assert.equal(result.ok, true);
  const db = new Database(out, { readonly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE mode = ?').get('code').count, empty ? 0 : 1); }
  finally { db.close(); }
  assert.deepEqual(await fs.readFile(statePath), stateBefore, 'external output cannot advertise readiness in the selected input generation');
  assert.deepEqual(await fs.readFile(buildStatePath), buildStateBefore, 'external output cannot update the source generation phase, heartbeat or checkpoints');
  assert.deepEqual(await fs.readFile(manifestPath), manifestBefore, 'input publication registration stays unchanged');
  assert.equal(await fs.access(path.join(source.indexDir, 'pieces', 'sqlite-zero-state.json')).then(() => true, () => false), false,
    'detached empty builds create a real output database instead of writing zero-state evidence into the input');
  const previous = await fs.readFile(out);
  if (!empty) {
    const incorrect = JSON.parse(manifestBefore);
    incorrect.pieces.find(piece => piece.name === 'chunk_meta').count = 0;
    await fs.writeFile(manifestPath, JSON.stringify(incorrect));
    await assert.rejects(buildSqliteIndex(root, options), error => error.code === 'ERR_SQLITE_POSTIMPORT_ROW_COUNT_MISMATCH');
    assert.deepEqual(await fs.readFile(out), previous, 'a declared zero count cannot be replaced by an observed nonempty count');
    await fs.writeFile(manifestPath, manifestBefore);
  }
  const state = JSON.parse(stateBefore); state.mode = 'prose';
  await fs.writeFile(statePath, JSON.stringify(state));
  await assert.rejects(buildSqliteIndex(root, options), error => error.code === 'ERR_SQLITE_SOURCE_MODE');
  assert.deepEqual(await fs.readFile(out), previous, 'wrong-mode input rejects before replacing the prior database');
  await fs.writeFile(statePath, stateBefore);
  state.mode = 'code'; state.buildId = 'different-generation';
  await fs.writeFile(statePath, JSON.stringify(state));
  await assert.rejects(buildSqliteIndex(root, options), error => error.code === 'ERR_SQLITE_SOURCE_GENERATION');
  assert.deepEqual(await fs.readFile(out), previous, 'conflicting source generations reject before replacing the prior database');
  await fs.writeFile(statePath, stateBefore);
}
console.log(`SQLite ${selected} keeps explicit source, output and generation-state authority distinct.`);
