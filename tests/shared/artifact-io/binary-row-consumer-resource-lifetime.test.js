import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { withVerifiedArtifactReadScope } from '../../../src/shared/artifact-io/verified-read-scope.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual public row consumer, canonical artifacts, hashes and fds.
// The standalone checksum pass remains separate from the lazy frame read pass.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected, matches = candidate => candidate === expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (matches(current)) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const root = await makeTempDir('poc-binary-row-consumer-');
const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync;
const originalParse = JSON.parse, originalReadFile = fs.readFileSync;
const disposal = new Set();
const restore = () => {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose;
  JSON.parse = originalParse; fs.readFileSync = originalReadFile;
};
try {
  const rows = [{ id: 0, value: 'first' }, { id: 1, value: 'second-😀' }];
  const texts = rows.map(row => JSON.stringify(row));
  const family = async (name, payloads) => {
    const dir = path.join(root, name); await fsp.mkdir(dir);
    const encoded = encodeBinaryRowFrames(payloads.map(text => Buffer.from(text)));
    const data = path.join(dir, 'sample.binary-columnar.bin');
    await fsp.writeFile(data, encoded.dataBuffer);
    await fsp.writeFile(path.join(dir, 'sample.binary-columnar.offsets.bin'), encoded.offsetsBuffer);
    await fsp.writeFile(path.join(dir, 'sample.binary-columnar.lengths.varint'), encoded.lengthsBuffer);
    await fsp.writeFile(path.join(dir, 'sample.binary-columnar.meta.json'), JSON.stringify({ fields: {
      format: 'binary-columnar-v1', count: payloads.length, data: path.basename(data),
      offsets: 'sample.binary-columnar.offsets.bin', lengths: 'sample.binary-columnar.lengths.varint'
    } }));
    const checksum = buffer => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
    await writePiecesManifest(dir, [
      { name: 'sample', path: path.basename(data), format: 'binary-columnar', checksum: checksum(encoded.dataBuffer) },
      { name: 'sample_binary_columnar_offsets', path: 'sample.binary-columnar.offsets.bin', format: 'binary', checksum: checksum(encoded.offsetsBuffer) },
      { name: 'sample_binary_columnar_lengths', path: 'sample.binary-columnar.lengths.varint', format: 'varint', checksum: checksum(encoded.lengthsBuffer) },
      { name: 'sample_binary_columnar_meta', path: 'sample.binary-columnar.meta.json', format: 'json' }
    ]);
    return { dir, data };
  };
  const valid = await family('valid', texts), invalid = await family('invalid', ['{invalid-json', texts[1]]);
  const install = ({ data }, close = null) => {
    const state = { fd: null, opens: 0, reads: 0, frameCloses: 0, checksumCloses: 0, records: 0 };
    fs.openSync = (target, ...args) => {
      const opened = originalOpen(target, ...args);
      if (target === data) { state.fd = opened; state.opens += 1; disposal.add(opened); }
      return opened;
    };
    fs.readSync = (fd, ...args) => {
      if (fd === state.fd && state.opens === 2) state.reads += 1;
      return originalRead(fd, ...args);
    };
    fs.closeSync = fd => {
      if (fd === state.fd) {
        if (state.opens === 1) state.checksumCloses += 1;
        else { state.frameCloses += 1; if (close) return close(state); }
      }
      const result = originalClose(fd); disposal.delete(fd); return result;
    };
    fs.readFileSync = (target, ...args) => {
      if (target === data) assert.fail('public binary row stream cannot materialize the full payload');
      return originalReadFile(target, ...args);
    };
    return state;
  };
  const scoped = (selected, state, action) => withVerifiedArtifactReadScope({ root: selected.dir,
    record: target => { if (target === selected.data) { assert.equal(state.frameCloses, 1); state.records += 1; } }
  }, action);
  for (const strict of [true, false]) {
    {
      const state = install(valid);
      const iterator = loadJsonArrayArtifactRows(valid.dir, 'sample', { strict });
      await iterator.return('unstarted'); assert.equal(state.opens, 0); restore();
    }
    {
      const state = install(valid), actual = [];
      await scoped(valid, state, async () => {
        for await (const row of loadJsonArrayArtifactRows(valid.dir, 'sample', { strict })) actual.push(row);
      });
      assert.deepEqual(actual, rows); assert.equal(state.opens, 2); assert.equal(state.checksumCloses, 1);
      assert.equal(state.frameCloses, 1); assert.equal(state.records, strict ? 1 : 0); restore();
    }
    for (const mode of ['return', 'break', 'body-throw']) {
      const state = install(valid), primary = Object.freeze(new Error('ordinary consumer body failure'));
      await scoped(valid, state, async () => {
        const iterator = loadJsonArrayArtifactRows(valid.dir, 'sample', { strict });
        if (mode === 'return') {
          assert.deepEqual((await iterator.next()).value, rows[0]);
          assert.deepEqual(await iterator.return('early'), { value: 'early', done: true });
        } else if (mode === 'break') {
          for await (const row of iterator) { assert.deepEqual(row, rows[0]); break; }
        } else {
          const failure = await rejected(async () => { for await (const row of iterator) { void row; throw primary; } });
          assert.equal(failure, primary);
        }
      });
      assert.equal(state.opens, 2); assert.equal(state.frameCloses, 1); assert.equal(state.reads, 1); assert.equal(state.records, 0); restore();
    }
    {
      const secondary = Object.freeze(new Error('public early break original close failure'));
      const state = install(valid, () => { throw secondary; });
      const failure = await rejected(() => scoped(valid, state, async () => {
        for await (const row of loadJsonArrayArtifactRows(valid.dir, 'sample', { strict })) { assert.deepEqual(row, rows[0]); break; }
      }));
      assert.equal(contains(failure, secondary), true); assert.equal(state.frameCloses, 1); assert.equal(state.reads, 1);
      const session = getContainedFileSession(failure); caught(() => session.releaseAfterCloseSync());
      assert.equal(state.frameCloses, 1); assert.equal(state.records, 0);
      originalClose(state.fd); disposal.delete(state.fd); assert.equal(session.isSettled(), false); restore();
    }
    {
      let settled = false;
      const primary = Object.assign(new Error('explicit public throw still owns native work'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      });
      const state = install(valid);
      await scoped(valid, state, async () => {
        const iterator = loadJsonArrayArtifactRows(valid.dir, 'sample', { strict });
        assert.deepEqual((await iterator.next()).value, rows[0]);
        const failure = await rejected(() => iterator.throw(primary)), session = getContainedFileSession(failure);
        assert.equal(contains(failure, primary), true); assert.ok(session); assert.equal(state.frameCloses, 0);
        primary.cacheOwnershipReleased = () => true;
        caught(() => session.releaseAfterCloseSync()); assert.equal(state.frameCloses, 0);
        fs.closeSync = () => assert.fail('recovery must call only the captured original close');
        settled = true; session.releaseAfterCloseSync();
        assert.equal(state.frameCloses, 1); assert.equal(state.reads, 1); assert.equal(state.records, 0);
        assert.equal(failure.cacheOwnershipReleased(), true); assert.equal((await iterator.next()).done, true);
      });
      restore();
    }
    {
      const secondary = Object.freeze(new Error('invalid JSON plus independent close failure'));
      const state = install(invalid, () => { throw secondary; });
      const failure = await rejected(() => loadJsonArrayArtifactRows(invalid.dir, 'sample', { strict }).next());
      assert.equal(failure.code, 'ERR_ARTIFACT_CORRUPT'); assert.equal(contains(failure, secondary), true);
      assert.equal(contains(failure, null, value => value instanceof SyntaxError), true);
      assert.equal(state.opens, 2); assert.equal(state.frameCloses, 1); assert.equal(state.reads, 1);
      caught(() => getContainedFileSession(failure).releaseAfterCloseSync()); assert.equal(state.frameCloses, 1);
      originalClose(state.fd); disposal.delete(state.fd); restore();
    }
    for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen original row parse failure'))]) {
      const state = install(valid), secondary = Object.freeze(new Error('independent row close failure'));
      // Capture this original close before frame admission; metadata/checksum use their real owners.
      fs.closeSync = fd => {
        if (fd === state.fd && state.opens === 2) { state.frameCloses += 1; throw secondary; }
        const result = originalClose(fd); disposal.delete(fd); return result;
      };
      JSON.parse = (text, ...args) => { if (text === texts[0]) throw primary; return originalParse(text, ...args); };
      const failure = await rejected(() => loadJsonArrayArtifactRows(valid.dir, 'sample', { strict }).next());
      assert.equal(failure.code, 'ERR_ARTIFACT_CORRUPT'); assert.equal(contains(failure, primary), true);
      assert.equal(contains(failure, secondary), true); assert.equal(state.reads, 1); assert.equal(state.frameCloses, 1);
      assert.ok(getContainedFileSession(failure)); originalClose(state.fd); disposal.delete(state.fd); restore();
    }
    {
      let settled = false;
      const primary = Object.assign(new Error('original row parser observer remains native authority'), {
        cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      });
      const state = install(valid);
      JSON.parse = (text, ...args) => { if (text === texts[0]) throw primary; return originalParse(text, ...args); };
      const failure = await rejected(() => loadJsonArrayArtifactRows(valid.dir, 'sample', { strict }).next());
      const session = getContainedFileSession(failure);
      assert.equal(failure.code, 'ERR_ARTIFACT_CORRUPT'); assert.equal(state.frameCloses, 0);
      primary.cacheOwnershipReleased = () => true;
      caught(() => session.releaseAfterCloseSync()); assert.equal(state.frameCloses, 0);
      settled = true; session.releaseAfterCloseSync(); assert.equal(state.frameCloses, 1); assert.equal(state.reads, 1);
      restore();
    }
  }
} finally {
  restore();
  for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('binary-row-consumer-resource-lifetime passed');
