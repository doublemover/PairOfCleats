import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GENERATED_ARTIFACT_PREFIX_BYTES, generatedMapCacheIdentity, createMapCacheEnvelope,
  inspectGeneratedArtifact } from '../../src/shared/generated-artifact.js';
import { getContainedFileSession } from '../../src/shared/contained-file.js';
import { readStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

// UNVALIDATED: actual public discovery consumer and disposable original FileHandles.
const root = await makeTempDir('poc-generated-prefix-resource-'), open = fs.open;
const retained = new Map(); let sequence = 0;
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    for (const field of ['cause', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(current, field);
      if (!descriptor || !('value' in descriptor)) continue;
      if (field === 'errors' && Array.isArray(descriptor.value)) queue.push(...descriptor.value);
      else if (field === 'cause') queue.push(descriptor.value);
    }
    queue.push(...(readStorageFailureContext(current)?.inspectionErrors || []));
  }
  return false;
};
const fixture = async options => {
  fs.open = open;
  const identity = generatedMapCacheIdentity(`fixture-${sequence++}`), filePath = path.join(root, identity.fileName);
  const bytes = Buffer.from(JSON.stringify(createMapCacheEnvelope({ payload: 'x'.repeat(16000) }, identity.key)));
  await fs.writeFile(filePath, bytes);
  const state = { closes: 0, reads: 0, stats: 0, opened: 0, bytes: 0, positions: [], allowClose: false };
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args); if (target !== filePath) return handle;
    const close = handle.close, read = handle.read, stat = handle.stat; state.opened++;
    retained.set(handle, () => close.call(handle));
    handle.close = async function () {
      assert.equal(this, handle); state.closes++;
      if (options?.closeFailure && !state.allowClose) throw options.closeFailure;
      const result = await close.call(handle); retained.delete(handle); return result;
    };
    handle.read = async function (buffer, offset, length, position) {
      assert.equal(this, handle); state.reads++; state.positions.push(position);
      if (options?.readFailurePresent) throw options.readFailure;
      if (options?.invalidProgress !== undefined) return { bytesRead: options.invalidProgress };
      const result = await read.call(handle, buffer, offset, Math.min(length, 17), position);
      state.bytes += result.bytesRead; return result;
    };
    handle.stat = async function (...values) {
      assert.equal(this, handle); state.stats++;
      if (state.stats === 1) {
        handle.read = () => assert.fail('replacement read must not run');
        handle.stat = () => assert.fail('replacement stat must not run');
        handle.close = () => assert.fail('replacement close must not run');
      }
      const result = await stat.call(handle, ...values);
      if (state.stats === 2 && options?.changedStamp) return new Proxy(result, {
        get(targetStat, field) { return field === 'mtimeNs' ? targetStat.mtimeNs + 1n : Reflect.get(targetStat, field); }
      });
      return result;
    };
    return handle;
  };
  const input = { repoRoot: root, filePath, relativePath: identity.fileName };
  return { state, input, bytes };
};
try {
  let reads = 0;
  assert.equal(await inspectGeneratedArtifact({ repoRoot: root, filePath: path.join(root, 'authored.js'),
    relativePath: 'authored.js', readPrefix() { reads++; assert.fail('ordinary paths must not read'); } }), null);
  assert.equal(reads, 0);
  {
    const { state, input, bytes } = await fixture();
    const result = await inspectGeneratedArtifact(input); assert.equal(result.action, 'omit');
    assert.equal(state.opened, 1); assert.equal(state.closes, 1); assert.equal(state.stats, 2);
    assert.equal(state.bytes, GENERATED_ARTIFACT_PREFIX_BYTES); assert.ok(bytes.length > state.bytes);
    assert.ok(state.reads > 1); assert.equal(state.positions[0], 0);
    assert.equal(state.positions.at(-1) < GENERATED_ARTIFACT_PREFIX_BYTES, true);
  }
  for (const invalidProgress of [0, -1, 0.5, NaN, Infinity, GENERATED_ARTIFACT_PREFIX_BYTES + 1]) {
    const { state, input } = await fixture({ invalidProgress });
    assert.equal(await inspectGeneratedArtifact(input), null);
    assert.equal(state.closes, 1); assert.equal(state.reads, 1);
  }
  {
    const { state, input } = await fixture({ changedStamp: true });
    assert.equal(await inspectGeneratedArtifact(input), null); assert.equal(state.closes, 1);
  }
  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('ordinary prefix read failure'))]) {
    const { state, input } = await fixture({ readFailurePresent: true, readFailure: value });
    assert.equal(await inspectGeneratedArtifact(input), null); assert.equal(state.closes, 1);
  }
  for (const mode of ['read', 'close', 'read-and-close']) {
    let ready = false;
    const primary = mode === 'read' ? Object.defineProperty(new Error('pending original prefix read'), 'cacheOwnershipReleased', {
      value() { assert.equal(this, primary); return ready; }, writable: true
    }) : false;
    const secondary = Object.freeze(new Error('independent original prefix close failure'));
    const { state, input } = await fixture({ readFailurePresent: mode !== 'close', readFailure: primary,
      ...(mode !== 'read' ? { closeFailure: secondary } : {}) });
    const failure = await rejected(() => inspectGeneratedArtifact(input));
    if (mode !== 'close') assert.equal(contains(failure, primary), true);
    if (mode !== 'read') assert.equal(contains(failure, secondary), true);
    const session = getContainedFileSession(failure); assert.ok(session);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(state.closes, mode === 'read' ? 0 : 1);
    const readCount = state.reads, statCount = state.stats;
    if (mode === 'read') {
      primary.cacheOwnershipReleased = () => true;
      await rejected(() => session.releaseAfterClose()); assert.equal(state.closes, 0);
      ready = true;
    }
    state.allowClose = true; await session.releaseAfterClose();
    assert.equal(state.closes, mode === 'read' ? 1 : 2);
    assert.equal(state.reads, readCount); assert.equal(state.stats, statCount);
    assert.equal(failure.cacheOwnershipReleased(), true);
  }
  fs.open = open;
  for (const flag of [undefined, false, true]) {
    let ready = false, codeReads = 0;
    const primary = Object.defineProperties(new Error('original custom prefix observation'), {
      ...(flag === undefined ? {} : { cacheOwnershipPending: { value: flag } }),
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return ready; }, writable: true },
      code: { get() { codeReads++; return 'ENOENT'; } }
    });
    const failure = await rejected(() => inspectGeneratedArtifact({ repoRoot: root, filePath: 'unused',
      relativePath: generatedMapCacheIdentity('custom').fileName, readPrefix: async () => { throw primary; } }));
    assert.equal(contains(failure, primary), true); assert.equal(codeReads, 0);
    primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let ready = false;
    const identity = generatedMapCacheIdentity('returned'), prefix = Buffer.from(JSON.stringify(createMapCacheEnvelope({}, identity.key)));
    Object.defineProperty(prefix, 'cacheOwnershipReleased', { value() { assert.equal(this, prefix); return ready; }, writable: true });
    const failure = await rejected(() => inspectGeneratedArtifact({ repoRoot: root, filePath: 'unused',
      relativePath: identity.fileName, readPrefix: async () => prefix }));
    assert.equal(contains(failure, prefix), true); prefix.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    let ready = false;
    const secondary = Object.freeze(Object.assign(new Error('diagnostic getter owns work'), { cacheOwnershipReleased: () => ready }));
    const primary = Object.freeze(Object.defineProperty(new Error('custom prefix failure'), 'code', { get() { throw secondary; } }));
    const failure = await rejected(() => inspectGeneratedArtifact({ repoRoot: root, filePath: 'unused',
      relativePath: generatedMapCacheIdentity('getter').fileName, readPrefix: async () => { throw primary; } }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
} finally {
  fs.open = open;
  for (const dispose of retained.values()) await dispose();
  await rmDirRecursive(root);
}
console.log('Generated artifact discovery retains exact original prefix descriptor outcomes.');
