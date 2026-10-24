import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticServingFixture } from '../../helpers/semantic-serving-fixture.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { checksumString } from '../../../src/shared/hash.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

// Real schema-valid family/query/operation metadata and actual contained owners.
const fixture = await createSemanticServingFixture();
const originalOpen = fs.open;
const open = signal => openPublishedSemanticStore({ indexDir: fixture.indexDir, repoRoot: fixture.root,
  generation: fixture.generation, requireQueryIndex: true, signal });
const files = [...fixture.originals.keys()].map(name => path.resolve(fixture.indexDir, name + '.json'));
const dispose = new Map();
const install = ({ read = null, stat = null, close = null, beforeOpen = null } = {}) => {
  const states = [];
  fs.open = async (file, ...args) => {
    const filename = path.resolve(String(file));
    if (beforeOpen) await beforeOpen(filename);
    const handle = await originalOpen(file, ...args), nativeRead = handle.read, nativeStat = handle.stat, nativeClose = handle.close;
    const state = { filename, handle, reads: 0, bytes: 0, maxRead: 0, closes: 0 }; states.push(state);
    dispose.set(handle, () => nativeClose.call(handle));
    handle.read = async function (...readArgs) {
      assert.equal(this, handle); state.reads++; state.maxRead = Math.max(state.maxRead, readArgs[2]);
      const native = async (...next) => { const value = await nativeRead.call(handle, ...next); state.bytes += value.bytesRead; return value; };
      return read ? read(state, native, ...readArgs) : native(...readArgs);
    };
    handle.stat = function (...statArgs) {
      const native = (...next) => nativeStat.call(handle, ...next);
      return stat ? stat(state, native, ...statArgs) : native(...statArgs);
    };
    handle.close = function () {
      state.closes++;
      const native = async () => { const value = await nativeClose.call(handle); dispose.delete(handle); return value; };
      return close ? close(state, native) : native();
    };
    return handle;
  };
  return states;
};
const rewrite = async (name, value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  await fs.writeFile(path.join(fixture.indexDir, name + '.json'), bytes);
  const registration = structuredClone(fixture.registration);
  const piece = registration.pieces.find(piece => piece.name === name);
  piece.bytes = bytes.length; piece.checksum = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(fixture.registrationPath, JSON.stringify(registration));
};
try {
  {
    const states = install();
    const { store, manifest } = await open();
    assert.deepEqual(manifest.warnings, ['A']);
    assert.equal((await store.getRecords([fixture.ref]))[0].id, 0);
    assert.equal((await store.findOperations({ field: 'astKind', value: 'Identifier' })).refs.length, 2);
    for (const file of files) {
      const opened = states.filter(state => state.filename === file);
      assert.equal(opened.length, 1); assert.ok(opened[0].reads >= 2);
      assert.equal(opened[0].bytes, (await fs.stat(file)).size);
      assert.ok(opened[0].maxRead <= 65536);
    }
    assert.ok(states.every(state => state.handle.fd === -1 && state.closes === 1));
    // Mutating the returned manifest cannot change the store's generation owner.
    manifest.generation.baseBuildId = 'foreign';
    assert.deepEqual(store.generation, fixture.generation);
    assert.equal((await store.findOperations({ field: 'astKind', value: 'Identifier' })).refs.length, 2);
    fs.open = originalOpen;
  }
  // Every supported registration hashes the retained bytes, with no path reopen.
  for (const algorithm of ['sha1', 'xxh64']) {
    const registration = structuredClone(fixture.registration);
    for (const piece of registration.pieces.filter(piece => fixture.originals.has(piece.name))) {
      const bytes = fixture.originals.get(piece.name);
      piece.checksum = algorithm === 'xxh64' ? await checksumString(bytes).then(hash => hash.algo + ':' + hash.value)
        : 'sha1:' + createHash('sha1').update(bytes).digest('hex');
    }
    await fs.writeFile(fixture.registrationPath, JSON.stringify(registration));
    assert.deepEqual((await open()).manifest.warnings, ['A']);
    await fixture.restore();
  }
  for (const filename of files) {
    for (const mode of ['rewrite', 'growth', 'truncate', 'short-read', 'after-close']) {
      let changed = false;
      const original = await fs.readFile(filename);
      const replacement = Buffer.from(original.toString('utf8').replace(/"schemaVersion":([12])/, '"schemaVersion":9'));
      assert.equal(original.length, replacement.length);
      const states = install({
        read: async (state, native, buffer, offset, length, position) => {
          const result = await native(buffer, offset, mode === 'short-read' ? Math.min(4096, length) : length, position);
          if (state.filename === filename && !changed && mode !== 'short-read' && mode !== 'after-close') {
            changed = true;
            if (mode === 'growth') await fs.appendFile(filename, 'extra');
            else if (mode === 'truncate') await fs.truncate(filename, 4);
            else await fs.writeFile(filename, replacement);
          }
          return result;
        },
        close: async (state, native) => {
          await native();
          if (state.filename === filename && mode === 'after-close') { changed = true; await fs.writeFile(filename, replacement); }
        }
      });
      try {
        if (mode === 'short-read' || mode === 'after-close') assert.deepEqual((await open()).manifest.warnings, ['A']);
        else await assert.rejects(open(), { code: 'ERR_SEMANTIC_INTEGRITY' }, filename + ': ' + mode);
        if (mode !== 'short-read') assert.equal(changed, true);
        assert.ok(states.every(state => state.handle.fd === -1 && state.closes === 1));
      } finally { fs.open = originalOpen; await fixture.restore(); }
    }
    {
      const controller = new AbortController();
      const states = install({ read: async (state, native, ...args) => {
        const value = await native(...args); if (state.filename === filename) controller.abort(); return value;
      } });
      await assert.rejects(open(controller.signal), { code: 'ABORT_ERR' });
      assert.equal(states.find(state => state.filename === filename).reads, 1, 'abort stops before another read window');
      assert.ok(states.every(state => state.handle.fd === -1)); fs.open = originalOpen;
    }
    {
      const controller = new AbortController();
      const states = install({ close: async (state, native) => { await native(); if (state.filename === filename) controller.abort(); } });
      await assert.rejects(open(controller.signal), { code: 'ABORT_ERR' });
      assert.equal(states.at(-1).filename, filename, 'abort after read/close admits no later metadata owner');
      assert.ok(states.every(state => state.handle.fd === -1)); fs.open = originalOpen;
    }
    {
      // Verified reads use captured native descriptor metadata. Grow the real
      // file instead of replacing an unused async handle.stat method.
      await fs.truncate(filename, 32 * 1024 * 1024 + 1);
      const states = install();
      try {
        await assert.rejects(open(), { code: 'ERR_SEMANTIC_INTEGRITY' });
        const state = states.find(state => state.filename === filename);
        assert.equal(state.reads, 0); assert.equal(state.handle.fd, -1);
      } finally { fs.open = originalOpen; await fixture.restore(); }
    }
    {
      // Replace the regular file before its descriptor acquisition. No links or
      // platform-specific rename of an opened file are needed for this witness.
      const replacement = filename + '.replacement';
      const original = await fs.readFile(filename), changed = Buffer.from(original); changed[0] = 32;
      await fs.writeFile(replacement, changed);
      let replaced = false;
      const states = install({ beforeOpen: async file => {
        if (file === filename && !replaced) { replaced = true; await fs.rename(replacement, filename); }
      } });
      try { await assert.rejects(open(), { code: 'ERR_SEMANTIC_INTEGRITY' }); assert.equal(replaced, true); }
      finally { fs.open = originalOpen; await fixture.restore(); }
      assert.ok(states.every(state => state.handle.fd === -1));
    }
  }
  {
    const controller = new AbortController(); controller.abort();
    const states = install(); await assert.rejects(open(controller.signal), { code: 'ABORT_ERR' });
    assert.equal(states.length, 0); fs.open = originalOpen;
  }
  for (const [name, value, code] of [
    ['semantic_query_index', { ...fixture.queryIndex, generation: { ...fixture.generation, baseBuildId: 'foreign' } }, 'ERR_SEMANTIC_GENERATION_MISMATCH'],
    ['semantic_operation_index', { ...fixture.operationIndex, generation: { ...fixture.generation, baseBuildId: 'foreign' } }, 'ERR_SEMANTIC_GENERATION_MISMATCH'],
    ['semantic_query_index', { ...fixture.queryIndex, partitionHashes: [] }, 'ERR_SEMANTIC_INTEGRITY'],
    ['semantic_operation_index', { ...fixture.operationIndex, partitionHashes: [] }, 'ERR_SEMANTIC_INTEGRITY'],
    ['semantic_query_index', { ...fixture.queryIndex, unknown: true }, 'ERR_SEMANTIC_QUERY_INDEX'],
    ['semantic_operation_index', { ...fixture.operationIndex, schemaVersion: 1 }, 'ERR_INDEX_FORMAT_UNSUPPORTED']
  ]) {
    await rewrite(name, value); await assert.rejects(open(), { code }); await fixture.restore();
  }
  for (const mode of ['checksum', 'missing-query', 'duplicate', 'wrong-member', 'part-hash', 'part-size']) {
    const registration = structuredClone(fixture.registration);
    const metadata = registration.pieces.find(piece => piece.name === 'semantic_manifest');
    if (mode === 'checksum') metadata.checksum = 'sha256:' + '0'.repeat(64);
    if (mode === 'missing-query') registration.pieces = registration.pieces.filter(piece => piece.name !== 'semantic_query_index');
    if (mode === 'duplicate') registration.pieces.push({ ...metadata });
    const member = registration.pieces.find(piece => piece.name === 'semantic_records');
    if (mode === 'wrong-member') member.name = 'semantic_edges';
    if (mode === 'part-hash') member.checksum = 'sha256:' + '0'.repeat(64);
    if (mode === 'part-size') member.bytes++;
    await fs.writeFile(fixture.registrationPath, JSON.stringify(registration));
    await assert.rejects(open(), { code: mode === 'missing-query' ? 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE' : 'ERR_SEMANTIC_INTEGRITY' });
    if (mode === 'missing-query') {
      const optional = await openPublishedSemanticStore({ indexDir: fixture.indexDir, repoRoot: fixture.root, generation: fixture.generation });
      assert.equal((await optional.store.getRecords([fixture.ref]))[0].id, 0);
      await assert.rejects(optional.store.getRelatedPage(fixture.ref, 'semantic_operands'), { code: 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE' });
    }
    await fixture.restore();
  }
  {
    let deny = true;
    const primary = Object.freeze(new Error('original metadata read failed'));
    const secondary = Object.freeze(Object.assign(new Error('original metadata close failed'), { code: 'ENOENT' }));
    const states = install({ read: state => { assert.equal(state.filename, files[0]); throw primary; },
      close: (_state, native) => { if (deny) throw secondary; return native(); } });
    let failure;
    try { await open(); assert.fail('must reject'); } catch (caught) { failure = caught; }
    assert.equal(failure.cacheOwnershipReleased(), false);
    const queue = [failure], seen = new Set();
    while (queue.length) { const value = queue.pop(); if (!value || seen.has(value)) continue; seen.add(value);
      if (value.cause) queue.push(value.cause); if (value.errors) queue.push(...value.errors); }
    assert.ok(seen.has(primary) && seen.has(secondary));
    assert.equal(states[0].closes, 1); deny = false;
    await getContainedFileSession(failure).releaseAfterClose();
    assert.equal(states[0].closes, 2); assert.equal(states[0].reads, 1); assert.equal(states[0].handle.fd, -1);
    fs.open = originalOpen;
  }
} finally {
  fs.open = originalOpen;
  for (const close of dispose.values()) await close();
  await fixture.cleanup();
}
console.log('Published semantic metadata uses one bounded verified snapshot and settled descriptor lifetime.');
