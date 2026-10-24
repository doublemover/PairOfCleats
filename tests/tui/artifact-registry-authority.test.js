import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bindArtifactScope, createTuiArtifactRegistry } from '../../tools/tui/operator/artifact-registry.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('tui-artifact-registry');
const repo = path.join(dir, 'repository');
await fs.mkdir(repo);
const file = path.join(repo, 'report.bin'), body = Buffer.from([0, 1, 128, 255]);
await fs.writeFile(file, body);
const row = target => bindArtifactScope({ kind: 'fixture:file', label: 'Report', path: target, exists: true },
  { root: repo, repoRoot: repo });
const registry = createTuiArtifactRegistry({ maxJobs: 2, maxArtifacts: 2, maxFileBytes: 8, maxTotalBytes: 8 });
let generation = registry.beginJob('first');
const capture = artifacts => registry.capture({ sourceJobId: 'first', generation, artifacts });
const choose = inventory => ({ sourceJobId: 'first', inventoryId: inventory.inventoryId, artifactId: inventory.artifacts[0].artifactId });
try {
  let inventory = await capture([row(file)]);
  assert.deepEqual(inventory.artifacts[0].actions, ['open', 'copy', 'export']);
  assert.equal(inventory.artifacts[0].snapshotVerified, true);
  let selection = choose(inventory);
  assert.deepEqual((await registry.resolve(selection)).read.buffer, body);
  assert.deepEqual((await registry.resolve(selection)).read.buffer, body, 'unchanged warm snapshots remain usable');

  // Observation JSON does not carry the collector's private scope binding.
  const observed = JSON.parse(JSON.stringify(row(file)));
  const untrusted = await capture([observed]);
  assert.deepEqual(untrusted.artifacts[0].actions, []);
  assert.equal(untrusted.artifacts[0].unavailableCode, 'ERR_TUI_ARTIFACT_SCOPE');
  assert.equal(untrusted.artifacts[0].artifactId, undefined);
  const external = path.join(dir, 'private.bin');
  await fs.writeFile(external, 'outside-sentinel');
  const escaped = await capture([row(external)]);
  assert.deepEqual(escaped.artifacts[0].actions, []);
  assert.equal(escaped.artifacts[0].unavailableCode, 'ERR_UNSAFE_FILE_PATH');
  assert.equal(JSON.stringify(escaped).includes('outside-sentinel'), false);

  inventory = await capture([row(file)]); selection = choose(inventory);
  await fs.writeFile(file, Buffer.from([0, 1, 128, 254]));
  await assert.rejects(registry.resolve(selection), { code: 'ERR_FILE_INTEGRITY' });
  await fs.writeFile(file, body);
  inventory = await capture([row(file)]); selection = choose(inventory);
  await fs.rename(file, path.join(repo, 'retired.bin'));
  await fs.writeFile(file, body);
  await assert.rejects(registry.resolve(selection), { code: 'ERR_FILE_CHANGED' }, 'matching bytes cannot relabel a replacement object');
  inventory = await capture([row(file)]); selection = choose(inventory);
  await fs.unlink(file);
  await assert.rejects(registry.resolve(selection), { code: 'ENOENT' });
  await fs.writeFile(file, body);

  inventory = await capture([row(file)]); selection = choose(inventory);
  generation = registry.beginJob('first');
  await assert.rejects(registry.resolve(selection), { code: 'ERR_TUI_ARTIFACT_STALE' }, 'a reused job id cannot retarget an old selection');
  inventory = await capture([row(file)]); selection = choose(inventory);
  await assert.rejects(registry.resolve({ ...selection, sourceJobId: 'different' }), { code: 'ERR_TUI_ARTIFACT_STALE' });
  await assert.rejects(registry.resolve({ ...selection, artifactId: 'unknown' }), { code: 'ERR_TUI_ARTIFACT_UNAVAILABLE' });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(registry.resolve(selection, { signal: cancelled.signal }), error => error.name === 'AbortError');

  const folder = row(repo), directory = await capture([folder]);
  assert.deepEqual(directory.artifacts[0].actions, ['open', 'copy'], 'directory observations must not claim file export');
  assert.equal((await registry.resolve(choose(directory))).pin.type, 'directory');
  const bounded = await capture([row(file), row(file), row(file)]);
  assert.equal(bounded.artifacts.length, 2);
  assert.equal((await capture([row(path.join(repo, 'missing'))])).artifacts[0].unavailableCode, 'ENOENT');
  await fs.writeFile(path.join(repo, 'large'), Buffer.alloc(9));
  assert.equal((await capture([row(path.join(repo, 'large'))])).artifacts[0].unavailableCode, 'ERR_FILE_TOO_LARGE');

  inventory = await capture([row(file)]); selection = choose(inventory);
  registry.beginJob('second'); registry.beginJob('third');
  await assert.rejects(registry.resolve(selection), { code: 'ERR_TUI_ARTIFACT_STALE' }, 'bounded retention expires authority instead of choosing another job');
  await registry.dispose(); await registry.dispose();
  await assert.rejects(registry.resolve(selection), { code: 'ERR_TUI_ARTIFACT_SESSION' });
} finally { await registry.dispose(); }

const lifecycle = createTuiArtifactRegistry();
const lifetimeGeneration = lifecycle.beginJob('lifetime');
const lifetimeInventory = await lifecycle.capture({ sourceJobId: 'lifetime', generation: lifetimeGeneration, artifacts: [row(file)] });
const lifetimeSelection = { sourceJobId: 'lifetime', inventoryId: lifetimeGeneration,
  artifactId: lifetimeInventory.artifacts[0].artifactId };
const open = fs.open;
let beginRead, releaseRead, closes = 0;
const started = new Promise(resolve => { beginRead = resolve; }), blocked = new Promise(resolve => { releaseRead = resolve; });
fs.open = async (...args) => {
  const handle = await open(...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
  handle.read = async (...input) => { beginRead(); await blocked; return read(...input); };
  handle.close = async () => { closes++; return close(); };
  return handle;
};
try {
  const resolving = lifecycle.resolve(lifetimeSelection);
  const rejected = assert.rejects(resolving, { name: 'AbortError' });
  await started;
  let finished = false;
  const disposing = lifecycle.dispose().then(() => { finished = true; });
  const disposingAgain = lifecycle.dispose();
  await Promise.resolve();
  assert.equal(finished, false, 'disposal must join the real opened descriptor, even after revoking authority');
  assert.equal(closes, 0);
  releaseRead(); await rejected; await disposing; await disposingAgain;
  assert.equal(finished, true); assert.equal(closes, 1);
} finally { releaseRead(); fs.open = open; await lifecycle.dispose(); }
console.log('Artifact registry authority passed: actual bytes/objects, stale and missing snapshots, private scopes, generations and bounded retention');
