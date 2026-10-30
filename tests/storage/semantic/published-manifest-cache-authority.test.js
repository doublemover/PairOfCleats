import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadPiecesManifest } from '../../../src/shared/artifact-io/manifest-read.js';
import { writeCache } from '../../../src/shared/artifact-io/cache.js';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createBaseIndex } from '../../indexing/validate/helpers.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('published-manifest-cache-authority/')[1];
assert.ok(['valid-generation', 'unsupported-format'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`semantic-manifest-cache-${selected}`);
let indexDir;
const writeUnsupported = async surface => {
  const bytes = JSON.stringify({ artifactSurfaceVersion: surface });
  await fs.writeFile(path.join(indexDir, 'semantic_manifest.json'), bytes);
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'fixture', pieces: [{ name: 'semantic_manifest', path: 'semantic_manifest.json', bytes: Buffer.byteLength(bytes),
      checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }] }));
};
if (selected === 'valid-generation') {
  ({ indexDir } = await createBaseIndex({ rootDir: path.join(dir, 'selected'), semantic: true,
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'build-A', mode: 'code' } }));
  assert.equal((await openPublishedSemanticStore({ indexDir, repoRoot: dir })).manifest.generation.baseBuildId, 'build-A');
} else {
  indexDir = path.join(dir, 'index-code'); await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await writeUnsupported('0.0.2');
}
const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const cached = loadPiecesManifest(indexDir, { repoRoot: dir }), pinnedSize = (await fs.stat(manifestPath)).size;
if (selected === 'valid-generation') {
  const next = await createBaseIndex({ rootDir: path.join(dir, 'replacement'), semantic: true,
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'build-B', mode: 'code' } });
  await fs.cp(next.indexDir, indexDir, { recursive: true });
} else await writeUnsupported('0.1.1');
assert.equal((await fs.stat(manifestPath)).size, pinnedSize, 'control retains a same-length source rewrite');
// A stat collision, or a rewrite between parse and cache publication, can
// attach the held older parse to the current memo key. Reproduce that boundary
// through the real cache publisher without altering contained-file stat checks.
writeCache(manifestPath, cached, { maxBytes: MAX_JSON_BYTES, view: 'manifest', strict: true });
assert.equal(loadPiecesManifest(indexDir, { repoRoot: dir }), cached,
  'control attaches the older parse to the current stat-keyed memo');
if (selected === 'valid-generation') {
  const current = await openPublishedSemanticStore({ indexDir, repoRoot: dir });
  assert.equal(current.manifest.generation.baseBuildId, 'build-B');
  assert.equal(current.store.generation.baseBuildId, 'build-B');
} else await assert.rejects(openPublishedSemanticStore({ indexDir, repoRoot: dir }),
  error => error.code === 'ERR_INDEX_FORMAT_UNSUPPORTED' && error.foundVersion === '0.1.1');
console.log(`Fresh semantic manifest authority preserves ${selected} under a warm parsed-memo collision.`);
