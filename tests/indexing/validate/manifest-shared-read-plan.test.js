#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadAndValidateManifest } from '../../../src/index/validate/manifest.js';
import { createValidationReadPlan } from '../../../src/index/validate/read-plan.js';
import { withVerifiedArtifactReadScope } from '../../../src/shared/artifact-io/verified-read-scope.js';
import { loadChunkMetaRows } from '../../../src/shared/artifact-io.js';
import { createXxhash64Hasher } from '../../../src/shared/hash/xxhash-backend.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';

ensureTestingEnv(process.env);
const root = resolveTestCachePath(process.cwd(), 'manifest-shared-read-plan');
const dir = path.join(root, 'index-code');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(path.join(dir, 'pieces'), { recursive: true });
const chunkFile = path.join(dir, 'chunk_meta.jsonl');
const manifestFile = path.join(dir, 'pieces', 'manifest.json');
const chunkBytes = Buffer.from(`${JSON.stringify({ id: 0, start: 0, end: 1, file: 'a.js', lang: 'javascript', chunkUid: 'uid-a', padding: 'x'.repeat(140000) })}\n`);
const opaqueBytes = Buffer.from([0, 1, 255, 128, 10]);
const reports = () => ({ report: { issues: [], warnings: [], hints: [] }, modeReport: { ok: true, missing: [], warnings: [] } });
const digest = async (algorithm, bytes) => {
  if (algorithm !== 'xxh64') return crypto.createHash(algorithm).update(bytes).digest('hex');
  const hasher = await createXxhash64Hasher(); hasher.update(bytes); return hasher.digest();
};
const seed = async (algorithm = 'sha256', { mismatch = false } = {}) => {
  await fs.writeFile(chunkFile, chunkBytes);
  await fs.writeFile(path.join(dir, 'opaque.bin'), opaqueBytes);
  const value = await digest(algorithm, chunkBytes);
  const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', stage: 'stage2', buildId: 'generation-a',
    pieces: [
      { name: 'chunk_meta', type: 'chunks', path: 'chunk_meta.jsonl', format: 'jsonl', checksum: `${algorithm}:${mismatch ? '0'.repeat(value.length) : value}` },
      { name: 'chunk_uid_map', path: 'opaque.bin', format: 'binary', checksum: `sha256:${await digest('sha256', opaqueBytes)}` }
    ] };
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  return manifest;
};
const evaluate = async ({ algorithm = 'sha256', mismatch = false, mutate = null } = {}) => {
  await seed(algorithm, { mismatch });
  const state = reports();
  const metrics = {};
  const plan = createValidationReadPlan({ root: dir, metrics });
  await withVerifiedArtifactReadScope(plan, async () => {
    const { manifest, finalizeManifest } = await loadAndValidateManifest({ ...state, mode: 'code', dir, strict: true, readPlan: plan });
    let rows = 0;
    for await (const row of loadChunkMetaRows(dir, { manifest, strict: true })) { assert.equal(row.chunkUid, 'uid-a'); rows += 1; }
    assert.equal(rows, 1);
    state.report.issues.push('semantic-tail');
    if (mutate) await mutate();
    await finalizeManifest();
  });
  return { ...state, metrics };
};
try {
  // Exercise the actual checksum-only descriptor, including its original close.
  // A recovered close must never resume reads or publish a failed invocation.
  await seed();
  const originalOpen = fs.open;
  const disposal = new Map();
  const contains = (error, expected, seen = new Set()) => {
    if (error === expected) return true;
    if (!error || typeof error !== 'object' || seen.has(error)) return false;
    seen.add(error);
    return (Object.hasOwn(error, 'cause') && contains(error.cause, expected, seen))
      || (Array.isArray(error.errors) && error.errors.some(value => contains(value, expected, seen)));
  };
  try {
    for (const readFailure of [null, Object.freeze(new Error('frozen checksum read failure')), false, undefined]) {
      let reads = 0, closes = 0, recover = false;
      const closeFailure = Object.freeze(new Error('independent checksum close failure'));
      fs.open = async (target, ...args) => {
        const handle = await originalOpen(target, ...args);
        if (path.resolve(target) !== path.join(dir, 'opaque.bin')) return handle;
        const close = handle.close.bind(handle), read = handle.read.bind(handle);
        disposal.set(handle, close);
        handle.read = (...input) => { reads += 1; if (readFailure !== null) throw readFailure; return read(...input); };
        handle.close = async () => {
          closes += 1;
          if (!recover) { if (readFailure === null) return false; throw closeFailure; }
          await close(); disposal.delete(handle);
        };
        return handle;
      };
      const metrics = {}, plan = createValidationReadPlan({ root: dir, metrics });
      await plan.prepare({ pieces: [{ path: 'opaque.bin', checksum: `sha256:${await digest('sha256', opaqueBytes)}` }] });
      let failure;
      await assert.rejects(withVerifiedArtifactReadScope(plan, () => plan.checksum(path.join(dir, 'opaque.bin'), 'sha256')),
        error => { failure = error; return true; });
      assert.equal(metrics.verifiedReads || 0, 0, 'unconfirmed close cannot publish integrity evidence');
      assert.equal(metrics.checksumOnlyReads || 0, 0);
      if (readFailure !== null) {
        assert.ok(contains(failure, readFailure), 'original falsey/frozen read failure remains reachable');
        assert.ok(contains(failure, closeFailure), 'independent original close failure remains reachable');
      }
      const session = getContainedFileSession(failure);
      assert.ok(session, 'retain the exact original descriptor owner');
      assert.equal(session.isSettled(), false);
      assert.equal(closes, 1, 'no automatic native close retry');
      const readsBeforeRecovery = reads;
      recover = true;
      await session.releaseAfterClose();
      assert.equal(session.isSettled(), true);
      assert.equal(closes, 2);
      assert.equal(reads, readsBeforeRecovery);
      assert.equal(metrics.verifiedReads || 0, 0, 'close-only recovery cannot publish a failed invocation');
    }
    let releaseClose, enteredClose;
    const closing = new Promise(resolve => { enteredClose = resolve; });
    const released = new Promise(resolve => { releaseClose = resolve; });
    fs.open = async (target, ...args) => {
      const handle = await originalOpen(target, ...args);
      if (path.resolve(target) !== path.join(dir, 'opaque.bin')) return handle;
      const close = handle.close.bind(handle);
      disposal.set(handle, close);
      handle.close = async () => { enteredClose(); await released; await close(); disposal.delete(handle); };
      return handle;
    };
    const metrics = {}, plan = createValidationReadPlan({ root: dir, metrics });
    let settled = false;
    const pending = withVerifiedArtifactReadScope(plan, () => plan.checksum(path.join(dir, 'opaque.bin'), 'sha256'));
    pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      await closing;
      assert.equal(settled, false);
      assert.equal(metrics.verifiedReads || 0, 0, 'even successful verification waits for actual native closure');
    } finally { releaseClose(); }
    assert.equal(await pending, await digest('sha256', opaqueBytes));
    assert.equal(metrics.verifiedReads, 1);
    assert.equal(metrics.checksumOnlyReads, 1);
  } finally {
    fs.open = originalOpen;
    await Promise.all([...disposal.values()].map(close => close()));
  }
  for (const algorithm of ['sha1', 'sha256', 'xxh64']) {
    const shared = await evaluate({ algorithm });
    assert.equal(shared.report.issues.some(issue => issue.includes('checksum')), false);
    assert.equal(shared.metrics.readsByPath[chunkFile], 1, `${algorithm} uses the decoded JSONL physical read`);
    assert.equal(shared.metrics.readsByPath[manifestFile], 1);
    assert.equal(shared.metrics.readsByPath[path.join(dir, 'opaque.bin')], 1, 'unconsumed binary family remains checksummed');
    assert.equal(shared.metrics.checksumOnlyReads, 1);
    assert.equal(shared.metrics.reusedIntegrityReads, 1);
    const eager = reports();
    await loadAndValidateManifest({ ...eager, mode: 'code', dir, strict: true });
    eager.report.issues.push('semantic-tail');
    assert.deepEqual(shared.report, eager.report, 'deferred diagnostics keep the eager order and verdict');
  }
  const late = await evaluate({ mismatch: true });
  assert.equal(late.modeReport.ok, false, 'successful parsing cannot admit a late checksum mismatch');
  const mismatchAt = late.report.issues.findIndex(issue => issue.includes('checksum mismatch'));
  assert.ok(mismatchAt >= 0 && mismatchAt < late.report.issues.indexOf('semantic-tail'));
  const sameSize = await evaluate({ mutate: async () => {
    const before = await fs.stat(chunkFile);
    await fs.writeFile(chunkFile, Buffer.from(chunkBytes.toString('utf8').replace('uid-a', 'uid-b')));
    await fs.utimes(chunkFile, before.atime, before.mtime);
    assert.equal((await fs.stat(chunkFile)).size, before.size);
  } });
  assert.ok(sameSize.report.issues.some(issue => issue.includes('manifest.json invalid')));
  const generation = await evaluate({ mutate: async () => {
    const content = await fs.readFile(manifestFile, 'utf8');
    await fs.writeFile(manifestFile, content.replace('generation-a', 'generation-b'));
  } });
  assert.ok(generation.report.issues.some(issue => issue.includes('manifest.json invalid')), 'generation change invalidates invocation evidence');

  await seed();
  const tampered = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  tampered.pieces[0].checksum = 'futurehash:1234';
  tampered.pieces.push({ name: 'file_meta', path: 'missing.json', format: 'json', checksum: `sha256:${'0'.repeat(64)}` });
  await fs.writeFile(manifestFile, JSON.stringify(tampered));
  const eagerInvalid = reports();
  await loadAndValidateManifest({ ...eagerInvalid, mode: 'code', dir, strict: true });
  const deferredInvalid = reports();
  const invalidPlan = createValidationReadPlan({ root: dir });
  await withVerifiedArtifactReadScope(invalidPlan, async () => {
    const loaded = await loadAndValidateManifest({ ...deferredInvalid, mode: 'code', dir, strict: true, readPlan: invalidPlan });
    await loaded.finalizeManifest();
  });
  assert.deepEqual(deferredInvalid, eagerInvalid, 'unsupported checksum and missing-piece diagnostics preserve order');

  await seed();
  const controller = new AbortController();
  const cancelledPlan = createValidationReadPlan({ root: dir, signal: controller.signal });
  await assert.rejects(withVerifiedArtifactReadScope(cancelledPlan, async () => {
    const loaded = await loadAndValidateManifest({ ...reports(), mode: 'code', dir, strict: true, readPlan: cancelledPlan, signal: controller.signal });
    controller.abort();
    for await (const row of loadChunkMetaRows(dir, { manifest: loaded.manifest, strict: true })) void row;
    await loaded.finalizeManifest();
  }), { name: 'AbortError' });

  const metadataPlan = createValidationReadPlan({ root: dir });
  await withVerifiedArtifactReadScope(metadataPlan, async () => {
    const loaded = await loadAndValidateManifest({ ...reports(), mode: 'code', dir, strict: true, readPlan: metadataPlan });
    for await (const row of loadChunkMetaRows(dir, { manifest: loaded.manifest, strict: true })) void row;
    const original = fsSync.lstatSync;
    try {
      fsSync.lstatSync = (target, ...args) => {
        const stat = original(target, ...args);
        return path.resolve(target) === chunkFile ? { ...stat, isSymbolicLink: () => true } : stat;
      };
      await assert.rejects(metadataPlan.checksum(chunkFile, 'sha256'), { code: 'ERR_UNSAFE_FILE_PATH' });
    } finally { fsSync.lstatSync = original; }
  });

  await seed();
  const productionMetrics = {};
  const report = await validateIndexArtifacts({ root, indexRoot: root, modes: ['code'], strict: true, sqliteEnabled: false,
    userConfig: { sqlite: { use: false }, indexing: { embeddings: { enabled: false }, postings: { fielded: false } } }, readMetrics: productionMetrics });
  assert.equal(productionMetrics.code.readsByPath[chunkFile], 1, 'ordinary production validation installs the read plan');
  assert.equal(productionMetrics.code.readsByPath[path.join(dir, 'opaque.bin')], 1);
  assert.equal(report.ok, false, 'minimal instrumentation fixture does not pretend to satisfy unrelated required families');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('manifest shared-read plan controls passed');
