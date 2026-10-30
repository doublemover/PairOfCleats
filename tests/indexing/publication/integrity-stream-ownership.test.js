import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { observePublicationIntegrity } from '../../../src/index/build/publication-integrity.js';
import { checksumString, hashFileObservation } from '../../../src/shared/hash.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('integrity-stream-ownership/')[1];
assert.ok(['equivalent', 'mixed-snapshot', 'failure-drain'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`publication-integrity-stream-${selected}`);
const manifestPath = path.join(dir, 'manifest.json'), originalOpen = fs.open, originalLstat = fs.lstat;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const payloads = new Map(Array.from({ length: 8 }, (_, i) => [`part-${i}.bin`, Buffer.from(`authored-${i}`)]));
const pieces = [];
for (const [name, bytes] of payloads) {
  await fs.writeFile(path.join(dir, name), bytes);
  const algorithm = Number(name[5]) % 3;
  const checksum = algorithm === 0 ? 'sha256:' + sha(bytes) : algorithm === 1
    ? 'sha1:' + createHash('sha1').update(bytes).digest('hex') : 'xxh64:' + (await checksumString(bytes)).value;
  pieces.push({ name, path: name, bytes: bytes.length, checksum });
}
const manifest = { pieces };
await fs.writeFile(manifestPath, JSON.stringify(manifest));
const opens = new Map(); let active = 0, peak = 0, preliminaryFileStats = 0;
let afterClose = null, beforeRead = null;
const handles = new Map();
fs.lstat = async function (target, ...args) {
  if (payloads.has(path.relative(dir, String(target)))) preliminaryFileStats++;
  return originalLstat.call(this, target, ...args);
};
fs.open = async function (target, ...args) {
  const handle = await originalOpen.call(this, target, ...args);
  const relative = path.relative(dir, String(target));
  if (!payloads.has(relative)) return handle;
  const read = handle.read, close = handle.close;
  opens.set(relative, (opens.get(relative) || 0) + 1);
  active++; peak = Math.max(peak, active);
  handles.set(handle, () => close.call(handle));
  handle.read = async function (...args) {
    if (beforeRead) await beforeRead(relative);
    await new Promise(resolve => setImmediate(resolve));
    return read.apply(this, args);
  };
  handle.close = async function () {
    await close.call(this); active--; handles.delete(handle);
    if (afterClose) await afterClose(relative);
  };
  return handle;
};
try {
  if (selected === 'equivalent') {
    const actual = await observePublicationIntegrity({ outDir: dir, manifestPath });
    const transcript = [...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([relative, bytes]) =>
      stableStringify({ path: relative, type: 'file', hash: sha(bytes) }) + '\n').join('');
    assert.deepEqual(actual, { schemaVersion: 1, algorithm: 'sha256',
      manifestHash: sha(stableStringify(manifest)), contentHash: sha(transcript) });
    assert.ok(peak > 1 && peak <= 4, 'actual readers overlap only within the four-reader window');
    assert.equal(active, 0);
    assert.deepEqual([...opens.values()], Array(8).fill(1), 'all registered algorithms share each single payload read');
    assert.equal(preliminaryFileStats, 0, 'regular members are classified by their actual contained hash descriptor');
    for (const [name, bytes] of payloads) {
      const observation = await hashFileObservation(path.join(dir, name), { containedRoot: dir,
        algorithms: ['sha256', 'sha1', 'xxh64', 'sha256'] });
      assert.equal(observation.bytes, bytes.length);
      assert.deepEqual(observation.value, { sha256: sha(bytes),
        sha1: createHash('sha1').update(bytes).digest('hex'), xxh64: (await checksumString(bytes)).value });
      assert.ok(Object.isFrozen(observation) && Object.isFrozen(observation.value));
    }
    const cancelled = new AbortController(); cancelled.abort(); const previous = [...opens];
    await assert.rejects(observePublicationIntegrity({ outDir: dir, manifestPath, signal: cancelled.signal }), { name: 'AbortError' });
    assert.deepEqual([...opens], previous, 'pre-cancelled publication starts no extra content reads');
    await fs.mkdir(path.join(dir, 'nested'));
    await fs.writeFile(path.join(dir, 'nested/child.bin'), 'nested');
    const directoryManifest = { pieces: [{ name: 'native', path: 'nested', format: 'dir' }, pieces[0]] };
    await fs.writeFile(manifestPath, JSON.stringify(directoryManifest));
    const nested = await observePublicationIntegrity({ outDir: dir, manifestPath });
    const expected = [{ path: 'nested', type: 'directory' },
      { path: 'nested/child.bin', type: 'file', hash: sha('nested') },
      { path: 'part-0.bin', type: 'file', hash: sha(payloads.get('part-0.bin')) }];
    assert.equal(nested.contentHash, sha(expected.map(row => stableStringify(row) + '\n').join('')),
      'directory and file transcript order is unchanged');
    for (const checksum of ['directory-has-no-file-checksum', 'sha256:' + '0'.repeat(64)]) {
      directoryManifest.pieces[0].checksum = checksum;
      await fs.writeFile(manifestPath, JSON.stringify(directoryManifest));
      const observed = await observePublicationIntegrity({ outDir: dir, manifestPath });
      assert.equal(observed.contentHash, nested.contentHash, 'directory dispatch retains its original checksum policy');
      assert.equal(observed.manifestHash, sha(stableStringify(directoryManifest)));
    }
    const beforeInvalid = [...opens];
    await fs.writeFile(manifestPath, JSON.stringify({ pieces: [{ ...pieces[0], checksum: 'sha256:bad' }] }));
    await assert.rejects(observePublicationIntegrity({ outDir: dir, manifestPath }), { code: 'ERR_ARTIFACT_PUBLICATION_INTEGRITY' });
    assert.deepEqual([...opens], beforeInvalid, 'invalid regular-file checksums are rejected before payload reads');
  } else if (selected === 'mixed-snapshot') {
    const name = 'part-0.bin', a = Buffer.from('AAAA'), b = Buffer.from('BBBB');
    await fs.writeFile(path.join(dir, name), a);
    await fs.writeFile(manifestPath, JSON.stringify({ pieces: [{ name, path: name, bytes: 4,
      checksum: 'xxh64:' + (await checksumString(b)).value }] }));
    let swapped = false;
    afterClose = async relative => {
      if (relative === name && !swapped) { swapped = true; await fs.writeFile(path.join(dir, name), b); }
    };
    await assert.rejects(observePublicationIntegrity({ outDir: dir, manifestPath }),
      { code: 'ERR_ARTIFACT_PUBLICATION_INTEGRITY' },
      'a registered B checksum cannot qualify an independently captured A content hash');
    assert.equal(swapped, true); assert.equal(opens.get(name), 1); assert.equal(active, 0);
    afterClose = null;
    assert.ok((await observePublicationIntegrity({ outDir: dir, manifestPath })).contentHash,
      'the actual stable B snapshot remains valid');
  } else {
    const primary = Object.freeze(Object.assign(new Error('original member read failed'), { code: 'EIO' }));
    let release, siblingEntered;
    const held = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { siblingEntered = resolve; });
    beforeRead = async relative => {
      if (relative === 'part-0.bin') throw primary;
      if (relative === 'part-1.bin') { siblingEntered(); await held; }
    };
    let settled = false;
    const outcome = observePublicationIntegrity({ outDir: dir, manifestPath }).then(
      value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    await entered; await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'failure cannot retire another admitted original descriptor');
    assert.ok(active > 0);
    release(); const result = await outcome;
    assert.ok(errorGraphIncludes(result.error, primary)); assert.equal(active, 0);
    assert.ok([...opens.keys()].every(name => Number(name[5]) < 4), 'no later reader batch starts after failure');
    beforeRead = null;
    assert.ok((await observePublicationIntegrity({ outDir: dir, manifestPath })).contentHash);
  }
} finally {
  fs.open = originalOpen; fs.lstat = originalLstat;
  for (const close of handles.values()) await close();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Publication ${selected} preserves same-stream hashes, deterministic order and original reader settlement.`);
