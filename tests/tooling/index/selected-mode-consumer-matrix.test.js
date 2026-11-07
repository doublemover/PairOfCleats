import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBaseIndex, defaultUserConfig } from '../../indexing/validate/helpers.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { describeIndexWorkflows, buildIndexWorkflowArgv } from '../../../tools/tui/operator/index-catalog.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const { dir } = await prepareIsolatedTestCacheDir('selected-mode-consumer-matrix'), repo = path.join(dir, 'repo');
await fs.mkdir(repo);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'custom-cache'),
  testConfig: { sqlite: defaultUserConfig.sqlite, lmdb: defaultUserConfig.lmdb },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const config = loadUserConfig(repo), cache = getRepoCacheRoot(repo, config), builds = path.join(cache, 'builds');
await fs.mkdir(builds, { recursive: true });
const current = path.join(builds, 'current.json'), write = (file, value) => fs.writeFile(file, JSON.stringify(value));
const make = async (name, modes) => {
  const buildRoot = path.join(builds, name); await fs.mkdir(buildRoot);
  for (const mode of modes) {
    const base = await createBaseIndex({ rootDir: path.join(dir, name + mode) });
    await fs.cp(base.indexDir, path.join(buildRoot, `index-${mode}`), { recursive: true });
    const statePath = path.join(buildRoot, `index-${mode}`, 'index_state.json');
    await write(statePath, { ...JSON.parse(await fs.readFile(statePath)), mode });
    const manifestPath = path.join(buildRoot, `index-${mode}`, 'pieces/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath));
    manifest.buildId = name; manifest.compatibilityKey = 'compat-' + name;
    manifest.pieces.forEach(piece => { if (piece.name === 'chunk_meta') piece.count = 1; });
    await write(manifestPath, manifest);
  }
  await write(path.join(buildRoot, 'build_state.json'), { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, modes }); return buildRoot;
};
const publish = roots => write(current, { buildId: 'current', buildRoot: Object.values(roots)[0],
  buildRootsByMode: roots, modes: Object.keys(roots), promotedAt: '2026-10-29T00:00:00Z', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
const run = async args => {
  const result = await spawnSubprocess(process.execPath, args, { env, timeoutMs: 5000,
    maxOutputBytes: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
  return { result, report: result.stdout ? JSON.parse(result.stdout) : null };
};
const validate = (target, mode = null) => run([path.resolve('tools/index/validate.js'), '--repo', repo,
  '--index-root', target, '--json', ...(mode ? ['--mode', mode] : [])]);
try {
  const both = await make('old-both', ['code', 'prose']), code = await make('new-code', ['code']), prose = await make('new-prose', ['prose']);
  await publish({ code: both, prose: both });
  let result = await validate(code); assert.equal(result.result.exitCode, 0, JSON.stringify(result.report)); assert.deepEqual(Object.keys(result.report.modes), ['code']);
  await publish({ code });
  result = await validate(both); assert.equal(result.result.exitCode, 0); assert.deepEqual(Object.keys(result.report.modes), ['code', 'prose']);
  for (const pointer of [null, '{corrupt', JSON.stringify({ artifactSurfaceVersion: '0.0.0' })]) {
    if (pointer === null) await fs.unlink(current); else await fs.writeFile(current, pointer);
    result = await validate(both); assert.equal(result.result.exitCode, 0, result.result.stderr);
    assert.equal(result.report.selection.source, 'explicit-index-root');
    assert.deepEqual(Object.keys(result.report.modes), ['code', 'prose']);
  }
  const command = describeIndexWorkflows().find(entry => entry.id === 'index.validate');
  const formArgv = buildIndexWorkflowArgv(command, { 'index-root': both }, { kind: 'repo', target: repo }, { env });
  const form = await run([path.resolve('bin/pairofcleats.js'), ...formArgv]);
  assert.equal(form.result.exitCode, 0, form.result.stderr); assert.deepEqual(Object.keys(form.report.modes), ['code', 'prose']);
  const only = await validate(both, 'code'); assert.deepEqual(Object.keys(only.report.modes), ['code']);
  const all = await validate(both, 'all'); assert.notEqual(all.result.exitCode, 0); assert.equal(Object.keys(all.report.modes).length, 4);
  const absent = await validate(path.join(dir, 'absent-target')); assert.notEqual(absent.result.exitCode, 0);
  await write(path.join(code, 'build_state.json'), { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, modes: ['code', 'prose'] });
  const declaredMissing = await validate(code); assert.notEqual(declaredMissing.result.exitCode, 0);
  assert.equal(declaredMissing.report.modes.prose.ok, false);
  await publish({ code, prose: both });
  const stats = () => run([path.resolve('tools/index/stats.js'), '--repo', repo, '--json']);
  let observed = await stats(); assert.equal(observed.result.exitCode, 0);
  assert.equal(observed.report.totals.chunkCount, 2); assert.equal(observed.report.indexRoot, null);
  assert.equal(observed.report.buildId, null); assert.equal(observed.report.mixedGenerations, true);
  assert.equal(observed.report.modes.prose.provenance.buildId, 'old-both');
  await publish({ code: both, prose });
  observed = await stats(); assert.equal(observed.report.totals.chunkCount, 2);
  assert.equal(observed.report.modes.code.provenance.buildId, 'old-both');
  assert.equal(observed.report.modes.prose.provenance.buildId, 'new-prose');
  const literal = await run([path.resolve('tools/index/stats.js'), '--index-dir', both, '--json']);
  assert.equal(literal.report.indexRoot, both); assert.equal(literal.report.buildId, 'old-both');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual CLI and typed TUI validation forms honor explicit roots; stats retain each published mode and literal forensic roots.');
