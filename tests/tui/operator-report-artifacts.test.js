import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectJobArtifacts } from '../../tools/tui/supervisor/artifacts.js';
import { createTuiArtifactRegistry } from '../../tools/tui/operator/artifact-registry.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('tui-report-artifacts');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const output = path.join(repo, 'bounded-map.html');
const outside = path.join(dir, 'private.html');
await fs.writeFile(output, '<!doctype html><title>bounded fixture map</title>');
await fs.writeFile(outside, 'outside sentinel');
const artifacts = await collectJobArtifacts({ request: { cwd: repo,
  argv: ['report', 'map', `--repo=${repo}`, `--out=${output}`] } });
assert.equal(artifacts.length, 1); assert.equal(artifacts[0].kind, 'report:output');
const registry = createTuiArtifactRegistry();
try {
  const generation = registry.beginJob('owned-map');
  const inventory = await registry.capture({ sourceJobId: 'owned-map', generation, artifacts });
  const row = inventory.artifacts[0];
  assert.equal(row.snapshotVerified, true); assert.deepEqual(row.actions, ['open', 'copy', 'export']);
  const request = { sourceJobId: 'owned-map', inventoryId: generation, artifactId: row.artifactId };
  assert.equal((await registry.resolve(request)).pin.target, output);
  await fs.writeFile(output, 'changed report bytes');
  await assert.rejects(registry.resolve(request));
  const rejected = await collectJobArtifacts({ request: { cwd: repo,
    argv: ['report', 'map', `--repo=${repo}`, `--out=${outside}`] } });
  assert.deepEqual(rejected, []);
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside sentinel');
} finally { await registry.dispose(); }
console.log('Known report outputs enter existing verified artifact actions only under their selected repository');
