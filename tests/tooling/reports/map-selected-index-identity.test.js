import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentBuildInfo } from '../../../tools/shared/dict-utils.js';
import { createMapSelectedIndexFixture } from '../../helpers/map-selected-index-fixture.js';

const fixture = await createMapSelectedIndexFixture('identity');
const { repo, config, a, b, firstBuild, secondBuild, map, names, cacheFiles } = fixture;
// Actual directory alias coverage has its own capable-launch fixture. This
// portable case retains every selection/cache/replacement/negative assertion.
try {
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
  await fixture.close();
}
