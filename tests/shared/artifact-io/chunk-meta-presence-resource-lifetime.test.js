import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../../../src/shared/file-read.js';
import { hasChunkMetaArtifactsAsync, hasChunkMetaArtifactsSync } from '../../../src/shared/artifact-io/chunk-meta-presence.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeCache } from '../../../src/shared/artifact-io/cache.js';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual coarse-presence consumers, disposable paths and FD counters.
const root = await makeTempDir('poc-chunk-presence-resource-'), dir = path.join(root, 'index');
await fsp.mkdir(dir);
const meta = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
const manifest = path.join(dir, 'pieces', 'manifest.json');
const valid = JSON.stringify({ data: 'data.bin', offsets: 'offsets.bin', lengths: 'lengths.bin' });
await fsp.writeFile(meta, valid);
for (const name of ['data.bin', 'offsets.bin', 'lengths.bin']) await fsp.writeFile(path.join(dir, name), 'x');
const open = fs.openSync, read = fs.readSync, close = fs.closeSync, stat = fs.statSync, access = fsp.access;
const disposal = new Set();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const restore = () => { fs.openSync = open; fs.readSync = read; fs.closeSync = close; fs.statSync = stat; fsp.access = access; };
const dispose = () => { for (const fd of disposal) { try { close(fd); } catch {} disposal.delete(fd); } };
const intercept = ({ readFailure = null, closeFailure = null, targetPath = meta } = {}) => {
  const state = { reads: 0, closes: 0, opens: 0, allowRead: readFailure === null, allowClose: closeFailure === null };
  fs.openSync = (name, ...args) => { const fd = open(name, ...args); if (name === targetPath) { state.opens += 1; disposal.add(fd); } return fd; };
  fs.readSync = (fd, ...args) => {
    if (disposal.has(fd)) { state.reads += 1; if (!state.allowRead) throw readFailure; } return read(fd, ...args);
  };
  fs.closeSync = fd => {
    if (disposal.has(fd)) {
      state.closes += 1; if (!state.allowClose) throw closeFailure;
      const result = close(fd); disposal.delete(fd); return result;
    }
    return close(fd);
  };
  return state;
};
try {
  assert.equal(hasChunkMetaArtifactsSync(dir), true); assert.equal(await hasChunkMetaArtifactsAsync(dir), true);
  assert.equal(await pathExists(meta), true); assert.equal(await pathExists(path.join(root, 'missing')), false);
  assert.equal(await pathExists(''), false);
  for (const asyncMode of [false, true]) {
    const state = intercept({ closeFailure: Object.freeze(new Error('metadata close failure cannot mean absent')) });
    const failure = await rejected(() => asyncMode ? hasChunkMetaArtifactsAsync(dir) : hasChunkMetaArtifactsSync(dir));
    const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    state.allowClose = true; await rejected(() => session.releaseAfterCloseSync()); assert.equal(state.closes, 1);
    dispose(); assert.equal(session.isSettled(), false); restore();
  }
  for (const asyncMode of [false, true]) {
    let ready = false;
    const primary = Object.assign(new Error('metadata read native prerequisite'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    const state = intercept({ readFailure: primary });
    const failure = await rejected(() => asyncMode ? hasChunkMetaArtifactsAsync(dir) : hasChunkMetaArtifactsSync(dir));
    const session = getContainedFileSession(failure); assert.ok(session); assert.equal(state.closes, 0);
    primary.cacheOwnershipReleased = () => true; await rejected(() => session.releaseAfterCloseSync());
    assert.equal(state.closes, 0); ready = true; session.releaseAfterCloseSync();
    assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(state.opens, 1); restore();
  }
  await fsp.writeFile(meta, '{malformed');
  assert.equal(hasChunkMetaArtifactsSync(dir), false); assert.equal(await hasChunkMetaArtifactsAsync(dir), false);
  await fsp.writeFile(meta, valid);
  await fsp.rm(path.join(dir, 'lengths.bin'));
  assert.equal(hasChunkMetaArtifactsSync(dir), false); assert.equal(await hasChunkMetaArtifactsAsync(dir), false);
  await fsp.writeFile(path.join(dir, 'lengths.bin'), 'x');
  // The first unknown existence probe must not fall through to an existing
  // compressed sibling, nor authorize a different candidate after replacement.
  await fsp.writeFile(path.join(dir, 'chunk_meta.json.gz'), 'compressed');
  for (const marker of [undefined, false, true]) {
    let ready = false, probes = 0;
    const primary = new Error('access ENOENT still owns native work'); primary.code = 'ENOENT';
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    fsp.access = async () => { probes += 1; throw primary; };
    const failure = await rejected(() => hasChunkMetaArtifactsAsync(dir));
    assert.equal(probes, 1); primary.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); ready = true;
    assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('ordinary completed access failure'))]) {
    fsp.access = async () => { throw primary; }; assert.equal(await pathExists(meta), false); restore();
  }
  await fsp.rm(meta); await fsp.rm(path.join(dir, 'chunk_meta.json.gz'));
  await fsp.mkdir(path.dirname(manifest)); await fsp.writeFile(manifest, '{}');
  {
    let ready = false;
    const primary = Object.assign(new Error('manifest path stat native prerequisite'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    });
    fs.statSync = (name, ...args) => { if (name === manifest) throw primary; return stat(name, ...args); };
    const failure = await rejected(() => hasChunkMetaArtifactsSync(dir));
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  const manifestMeta = path.join(dir, 'pieces', 'custom.meta.json');
  await fsp.writeFile(manifestMeta, JSON.stringify({ parts: ['pieces/data.json'] }));
  await fsp.writeFile(manifest, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey: 'presence-resource-fixture', pieces: [
      { name: 'chunk_meta_meta', path: 'pieces/custom.meta.json', format: 'json' },
      { name: 'chunk_meta', path: 'pieces/data.json', format: 'json' }
    ] }));
  for (const asyncMode of [false, true]) {
    writeCache(manifestMeta, { parts: ['pieces/data.json'] }, { maxBytes: MAX_JSON_BYTES, view: 'json', containedRoot: null });
    const state = intercept({ targetPath: manifestMeta, closeFailure: Object.freeze(new Error('manifest source metadata close failed')) });
    const failure = await rejected(() => asyncMode ? hasChunkMetaArtifactsAsync(dir) : hasChunkMetaArtifactsSync(dir));
    assert.ok(getContainedFileSession(failure)); assert.equal(state.opens, 1); assert.equal(state.closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), false, 'embedded missing-format source error cannot mean absent');
    dispose(); restore();
  }
  await fsp.writeFile(path.join(dir, 'pieces/data.json'), '[]');
  assert.equal(hasChunkMetaArtifactsSync(dir), true, 'cold contained metadata confirms original close');
  assert.equal(await hasChunkMetaArtifactsAsync(dir), true, 'warm contained metadata preserves valid presence');
  await fsp.writeFile(manifestMeta, JSON.stringify({ parts: ['pieces/data.json'], changed: 'fresh generation' }));
  const stale = intercept({ targetPath: manifestMeta, closeFailure: Object.freeze(new Error('stale metadata cache cannot hide current failed close')) });
  await rejected(() => hasChunkMetaArtifactsSync(dir));
  assert.equal(stale.opens, 1); assert.equal(stale.closes, 1); dispose(); restore();
  // Existing coarse oversized-manifest result still avoids parsing its bytes.
  await fsp.writeFile(manifest, 'x'.repeat(2 * 1024 * 1024 + 1));
  assert.equal(hasChunkMetaArtifactsSync(dir), true); assert.equal(await hasChunkMetaArtifactsAsync(dir), true);
} finally { restore(); dispose(); await rmDirRecursive(root); }
