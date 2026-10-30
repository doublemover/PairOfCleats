import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { withIndexStatePublicationLock } from '../../../src/shared/index-state-publication.js';
import { isFileLockPublicationPending } from '../../../src/shared/locks/file-lock.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const measure = async operation => {
  const cpu = process.cpuUsage(), start = performance.now();
  await operation();
  const wallMs = performance.now() - start, used = process.cpuUsage(cpu);
  return { wallMs, cpuUserMicros: used.user, cpuSystemMicros: used.system };
};

// The instrumented pass calls the original admitted descriptor methods and
// restores the fs entry points only after the publication promise settles.
const observeIo = async (root, operation) => {
  const originalOpen = fs.open, originalStat = fs.stat;
  const work = { opens: 0, pathStats: 0, reads: 0, readBytes: 0, descriptorStats: 0, closes: 0,
    liveDescriptors: 0, peakLiveDescriptors: 0, byPath: {} };
  fs.stat = async (target, ...args) => { work.pathStats++; return originalStat.call(fs, target, ...args); };
  fs.open = async (target, ...args) => {
    const handle = await originalOpen.call(fs, target, ...args);
    const label = path.relative(root, String(target)).replaceAll('\\', '/');
    const counts = work.byPath[label] ||= { opens: 0, reads: 0, readBytes: 0, closes: 0 };
    counts.opens++; work.opens++; work.liveDescriptors++;
    work.peakLiveDescriptors = Math.max(work.peakLiveDescriptors, work.liveDescriptors);
    const read = handle.read.bind(handle), stat = handle.stat.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...options) => {
      work.reads++; counts.reads++; const value = await read(...options);
      work.readBytes += value.bytesRead; counts.readBytes += value.bytesRead; return value;
    };
    handle.stat = async (...options) => { work.descriptorStats++; return stat(...options); };
    handle.close = async () => {
      const value = await close(); counts.closes++; work.closes++; work.liveDescriptors--; return value;
    };
    return handle;
  };
  try { await operation(); }
  finally { fs.open = originalOpen; fs.stat = originalStat; }
  assert.equal(work.liveDescriptors, 0); assert.equal(work.opens, work.closes);
  return work;
};

export const runScenario = async ({ destination }) => {
  const root = path.join(destination, 'manifest-input'); await fs.mkdir(root);
  const observations = [];
  try {
    const { default: xxhashWasm } = await import('xxhash-wasm');
    const { h64Raw } = await xxhashWasm();
    const entries = [], content = new Map();
    for (let id = 0; id < 17; id++) {
      const filename = `piece-${String(16 - id).padStart(2, '0')}.json`;
      const bytes = Buffer.from(JSON.stringify([{ id, text: 'bounded-payload'.repeat(256 + id) }]));
      await fs.writeFile(path.join(root, filename), bytes); content.set(filename, bytes);
      entries.push({ name: `sample-${id}`, path: filename, format: 'json', count: 1 });
    }
    const stateBytes = Buffer.from(JSON.stringify({ buildId: 'manifest-cost', mode: 'code' }));
    await fs.writeFile(path.join(root, 'index_state.json'), stateBytes); content.set('index_state.json', stateBytes);
    entries.push({ name: 'index_state', path: 'index_state.json', format: 'json' });
    const expectedPaths = [...content.keys()].sort();
    const verify = async sealed => {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'pieces/manifest.json'), 'utf8'));
      assert.deepEqual(manifest.pieces.map(piece => piece.path), expectedPaths);
      for (const piece of manifest.pieces) {
        const bytes = content.get(piece.path);
        assert.equal(piece.bytes, bytes.length);
        const checksum = sealed && piece.path !== 'index_state.json'
          ? `sha256:${sha256(bytes)}` : `xxh64:${h64Raw(bytes).toString(16).padStart(16, '0')}`;
        assert.equal(piece.checksum, checksum, 'independent bulk checksum over authored original bytes');
      }
      assert.equal(isFileLockPublicationPending(path.join(root, '.index_state.write.lock')), false);
      await assert.rejects(fs.access(path.join(root, '.index_state.write.lock')), { code: 'ENOENT' });
      let entered = false;
      await withIndexStatePublicationLock(root, () => { entered = true; });
      assert.equal(entered, true, 'original publication retired before the next actual owner enters');
      return sha256(Buffer.from(JSON.stringify(manifest.pieces)));
    };
    for (const sealed of [false, true]) {
      const pieceEntries = entries.map(entry => sealed ? { ...entry, bytes: content.get(entry.path).length,
        checksum: `sha256:${sha256(content.get(entry.path))}` } : { ...entry });
      const operation = () => writePiecesManifest({ outDir: root, mode: 'code', pieceEntries, indexState: { buildId: 'manifest-cost' } });
      await operation(); await verify(sealed);
      const cleanSamples = [];
      for (let trial = 0; trial < 3; trial++) { cleanSamples.push(await measure(operation)); await verify(sealed); }
      const allocation = await observeHeapAllocations({ destination, name: `manifest-${sealed ? 'sealed' : 'normal'}`, operation, iterations: 2 });
      const piecesSha256 = await verify(sealed);
      const work = await observeIo(root, operation); await verify(sealed);
      for (const entry of entries) {
        const observed = work.byPath[entry.path];
        if (sealed && entry.path !== 'index_state.json') assert.equal(observed, undefined, 'sealed payload never opens a checksum descriptor');
        else {
          assert.equal(observed.opens, 1); assert.equal(observed.closes, 1);
          assert.equal(observed.readBytes, content.get(entry.path).length);
        }
      }
      observations.push({ sealed, entries: entries.length, inputBytes: [...content.values()].reduce((sum, bytes) => sum + bytes.length, 0),
        inputIdentity: [...content].map(([filename, bytes]) => ({ path: filename, bytes: bytes.length, sha256: sha256(bytes) })),
        piecesSha256, cleanSamples, allocation, work, publication: 'original descriptors closed;pending ownership absent;next original lock entered' });
    }
    return { issue: 1754, claim: 'clean manifest paths only;fault/drain controls are separate original fixtures', observations };
  } finally { await fs.rm(root, { recursive: true, force: true }); }
};
