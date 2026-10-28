import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { inventoryBackendPayload as compatibilityInventory } from '../../../tools/build/embeddings/backend-payload-copy.js';
import { inventoryBackendPayload } from '../../../src/shared/artifact-io/backend-payload-inventory.js';
import { inventoryStageOutput, inventoryStageOutputForCopy, copyUnpublishedStageMembers } from '../../../src/index/build/stage-output.js';
import { publishStageDirectoryFixture } from '../../helpers/stage-directory-fixture.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
assert.equal(compatibilityInventory, inventoryBackendPayload, 'existing backend callers share the factored inventory owner');
const { dir: buildRoot } = await prepareTestCacheDir('stage-directory-inventory'), outDir = path.join(buildRoot, 'index-code');
await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(outDir, 'ordinary.txt'), 'ordinary');
const manifestPath = path.join(outDir, 'pieces/manifest.json');
await fs.writeFile(manifestPath, JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', buildId: 'fixture',
  pieces: [{ type: 'fixture', name: 'ordinary', format: 'text', path: 'ordinary.txt', bytes: 8 }] }));
const fixture = await publishStageDirectoryFixture({ outDir });
const options = { buildRoot, buildId: 'fixture', mode: 'code', scope: 'final-recovery' };
const first = await inventoryStageOutput(options), directory = first.inventory.find(part => part.representation === 'directory');
assert.equal(directory.path, fixture.piece.path); assert.equal(directory.binding.contract, 'lancedb-directory.v1');
assert.deepEqual(directory.binding.payload, fixture.payload);
assert.equal(directory.bytes, Buffer.byteLength('closed-writer-versionclosed-writer-data'));
assert.equal(first.output.pieces, 3, 'the ordinary member, directory family and metadata receipt retain independent manifest identities');
assert.ok(first.inventory.some(part => part.path === 'ordinary.txt' && part.bytes === 8));
assert.deepEqual((await inventoryStageOutput(options)).output, first.output);
await assert.rejects(inventoryStageOutputForCopy(options), /Stage2 snapshots/);
const selected = await inventoryStageOutputForCopy({ ...options, select: piece => piece.name === 'ordinary' });
assert.equal(selected.output.pieces, 1); assert.equal(selected.output.bytes, 8, 'file-only graph/snapshot selections remain independent of optional final families');
await assert.rejects(copyUnpublishedStageMembers({ inventory: first.inventory, sourceRoot: outDir,
  targetRoot: path.join(buildRoot, 'not-created'), assertOwned() {} }), /Stage2 copy/);
await assert.rejects(fs.stat(path.join(buildRoot, 'not-created')), { code: 'ENOENT' });
assert.equal(await inventoryBackendPayload({ dir: fixture.dir, limits: { entries: 1 } }), null,
  'bounded inventory admission remains unavailable rather than verified empty');
const empty = path.join(buildRoot, 'empty'); await fs.mkdir(empty);
assert.deepEqual(await inventoryBackendPayload({ dir: empty }), { version: 1, entries: [] });
const fragment = path.join(fixture.dir, 'vectors.lance', 'data', '1.lance'), original = await fs.readFile(fragment);
for (const mutation of ['change', 'add', 'remove', 'replace-kind']) {
  if (mutation === 'change') await fs.writeFile(fragment, 'CHANGED-writer-data');
  if (mutation === 'add') await fs.writeFile(path.join(fixture.dir, 'unexpected'), 'extra');
  if (mutation === 'remove' || mutation === 'replace-kind') await fs.unlink(fragment);
  if (mutation === 'replace-kind') await fs.mkdir(fragment);
  await assert.rejects(inventoryStageOutput(options), /inventory differs|payload|backend bytes|Invalid/);
  if (mutation === 'add') await fs.unlink(path.join(fixture.dir, 'unexpected'));
  if (mutation === 'replace-kind') await fs.rmdir(fragment);
  await fs.writeFile(fragment, original);
}
// Exercise the link-admission branch without creating a symlink or changing
// Windows privileges. This is an injected lstat observation, not physical-link
// qualification; the escape case below uses the real path resolver.
const lstat = fs.lstat;
fs.lstat = async function(filename, ...args) {
  const stat = await lstat.call(this, filename, ...args);
  if (filename === fragment) Object.defineProperty(stat, 'isSymbolicLink', { value: () => true });
  return stat;
};
try { await assert.rejects(inventoryStageOutput(options), /backend bytes changed/); }
finally { fs.lstat = lstat; }
await assert.rejects(inventoryBackendPayload({ dir: fixture.dir, limits: { entries: 4097 } }), /only lower/);
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const originalManifestBytes = await fs.readFile(manifestPath);
const restore = () => fs.writeFile(manifestPath, originalManifestBytes);
for (const mutate of [
  value => { value.pieces.find(piece => piece.format === 'dir').path = '../escape'; },
  value => { value.pieces.push({ ...value.pieces[0], path: './ordinary.txt' }); },
  value => { value.pieces.find(piece => piece.format === 'dir').name = 'unknown_directory'; },
  value => { value.pieces.push({ ...value.pieces.find(piece => piece.name.endsWith('_meta')), path: 'another-meta.json' }); }
]) {
  const changed = structuredClone(manifest); mutate(changed); await fs.writeFile(manifestPath, JSON.stringify(changed));
  await assert.rejects(inventoryStageOutput(options)); await restore();
}
assert.deepEqual((await inventoryStageOutput(options)).output, first.output);
console.log('Final directory-family identities bind exact closed-writer bytes, while Stage2 copies retain their file-only contract.');
