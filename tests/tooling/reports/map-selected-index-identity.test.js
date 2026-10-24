import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { getCurrentBuildInfo, getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-map-selected-index-')));
const repo = path.join(temp, 'repo');
await fs.mkdir(path.join(repo, 'src'), { recursive: true });
const env = applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'off',
  testConfig: createFastIndexingTestConfig({ indexing: { scm: { provider: 'none' },
    workerPool: { enabled: false }, typeInference: false, typeInferenceCrossFile: false,
    riskAnalysis: false, riskAnalysisCrossFile: false, embeddings: { enabled: false, mode: 'off' } },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } }) });
const config = loadUserConfig(repo);
const cacheDir = path.join(getRepoCacheRoot(repo, config), 'maps/cache');
const build = async (name, destination) => {
  await fs.writeFile(path.join(repo, 'src/current.js'), `export function ${name}() { return '${name}'; }\n`);
  await buildIndex(repo, { stage: 'stage1', modes: ['code'], threads: 1, log: () => {} });
  const info = getCurrentBuildInfo(repo, config, { mode: 'code' });
  assert.ok(info?.buildId);
  await fs.cp(info.activeRoot, destination, { recursive: true });
  return info;
};
const map = (selected = null, allowFailure = false) => {
  const result = runNode([path.join(root, 'tools/reports/report-code-map.js'), '--repo', repo,
    '--format', 'json', ...(selected ? ['--index-root', selected] : [])],
  'map selected index identity', repo, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
  if (allowFailure) return result;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
};
const names = model => [...new Set(model.nodes.flatMap(node => node.members.map(member => member.name)))];
const cacheFiles = () => fs.readdir(cacheDir);

try {
  const a = path.join(temp, 'index-a'), b = path.join(temp, 'index-b');
  const firstBuild = await build('alphaOrigin', a);
  const secondBuild = await build('bravoOrigin', b);
  assert.notEqual(firstBuild.buildId, secondBuild.buildId);
  const current = map();
  assert.deepEqual(names(current), ['bravoOrigin']);
  assert.equal((await cacheFiles()).length, 1);
  const first = map(a);
  assert.deepEqual(names(first), ['alphaOrigin'], 'explicit index cannot reuse the default cached map');
  const second = map(b);
  assert.deepEqual(names(second), ['bravoOrigin'], 'selected roots must not share a cached map');
  assert.equal((await cacheFiles()).length, 3);
  assert.deepEqual(map(a), first, 'same selected generation has a real warm-cache hit');
  assert.deepEqual(map(b), second);
  const alias = path.join(temp, 'index-a-alias');
  await fs.symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(map(alias), first, 'directory aliases canonicalize to the selected index');
  assert.equal((await cacheFiles()).length, 3);

  // Same selected path, and even a retained build ID, must observe changed
  // authoritative piece identities rather than borrowing the default pointer.
  await fs.rm(path.join(a, 'index-code'), { recursive: true, force: true });
  await fs.cp(path.join(b, 'index-code'), path.join(a, 'index-code'), { recursive: true });
  const manifestPath = path.join(a, 'index-code/pieces/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.buildId = firstBuild.buildId;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const replacement = map(a);
  assert.deepEqual(names(replacement), ['bravoOrigin']);
  assert.notDeepEqual(replacement, first);
  assert.equal((await cacheFiles()).length, 4);
  assert.equal(getCurrentBuildInfo(repo, config, { mode: 'code' }).buildId, secondBuild.buildId);
  assert.deepEqual(map(), current, 'external replacement does not alter default cache authority');

  await fs.writeFile(manifestPath, '{broken');
  const invalid = map(a, true);
  assert.notEqual(invalid.status, 0, 'warm cache must not hide an unreadable selected manifest');
  assert.equal(invalid.stdout, '');
  assert.equal((await cacheFiles()).length, 4, 'failed admission publishes no cached map');
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, artifactSurfaceVersion: '0.0.0' }));
  const incompatible = map(a, true);
  assert.notEqual(incompatible.status, 0);
  assert.match(incompatible.stderr, /ERR_INDEX_FORMAT_UNSUPPORTED/);
  assert.equal(incompatible.stdout, '');
  console.log('Map caches bind canonical selected roots, manifest generations and producer identity before admission.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
