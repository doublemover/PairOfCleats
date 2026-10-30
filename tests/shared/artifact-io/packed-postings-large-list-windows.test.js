import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { enqueueTokenPostingsArtifacts } from '../../../src/index/build/artifacts/token-postings.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { packTfPostings } from '../../../src/shared/packed-postings.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = await prepareArtifactIoTestDir('packed-postings-large-list-windows');
const original = { openSync: fs.openSync, closeSync: fs.closeSync, readSync: fs.readSync, readFileSync: fs.readFileSync };
const pairs = count => Array.from({ length: count }, (_, index) => [index * 129, index % 2 ? 300 : 1]);
const exact = Array.from({ length: 508 }, (_, index) => [index, index === 507 ? 2 ** 21 : 1]);
assert.equal(packTfPostings([exact]).buffer.length, 1024);
const samples = [];
try {
  for (const [shape, postings] of [['skewed', [pairs(600), pairs(6000), pairs(6000), exact]],
    ['many-short', Array.from({ length: 2048 }, (_, index) => [[index, 1], [index + 3000, 300]])]]) {
    const dir = path.join(root, shape); await fsp.mkdir(dir);
    const registry = createArtifactPieceRegistry({ outDir: dir, resolveArtifactTier: () => 'hot' }), tasks = [];
    await enqueueTokenPostingsArtifacts({ outDir: dir, postings: { tokenVocab: postings.map((_, i) => `t${i}`),
      tokenPostingsList: postings, avgDocLen: 1 }, state: { docLengths: [] }, tokenPostingsFormat: 'packed',
    enqueueWrite: (_label, fn) => tasks.push(fn), ...registry });
    for (const task of tasks) await task();
    await writePiecesManifest(dir, registry.listPieceEntries());
    const packedPath = path.join(dir, 'token_postings.packed.bin');
    let packedFd = null, reads = 0, peak = 0, eof = false;
    fs.openSync = (file, ...args) => { const fd = original.openSync(file, ...args);
      if (path.resolve(String(file)) === packedPath) packedFd = fd; return fd; };
    fs.closeSync = fd => { const result = original.closeSync(fd); if (fd === packedFd) packedFd = null; return result; };
    fs.readFileSync = (file, ...args) => {
      if (file === packedFd || (typeof file !== 'number' && path.resolve(String(file)) === packedPath)) assert.fail('whole packed payload read');
      return original.readFileSync(file, ...args);
    };
    fs.readSync = (fd, buffer, offset, length, position) => {
      if (fd !== packedFd) return original.readSync(fd, buffer, offset, length, position);
      reads++; peak = Math.max(peak, buffer.length);
      assert.ok(length <= 1024 && buffer.length <= 1024, 'every packed read and transient allocation stays in its selected window');
      return eof ? 0 : original.readSync(fd, buffer, offset, Math.min(length, 3), position);
    };
    const load = () => loadTokenPostings(dir, { strict: false, packedWindowBytes: 1024, packedWindowTokens: 128 }).postings;
    for (let sample = 0; sample < 3; sample++) {
      reads = 0; peak = 0; const start = performance.now();
      assert.deepEqual(load(), postings);
      samples.push({ shape, sample, elapsedMs: performance.now() - start, readCalls: reads,
        decodedPairs: postings.reduce((sum, list) => sum + list.length, 0), peakTransientBytes: peak });
      assert.equal(packedFd, null);
    }
    eof = true; assert.throws(load, { code: 'ERR_ARTIFACT_CORRUPT' }); assert.equal(packedFd, null); eof = false;
    const payload = await fsp.readFile(packedPath); payload[payload.length - 1] ^= 1; await fsp.writeFile(packedPath, payload);
    assert.throws(load, /checksum mismatch/); assert.equal(packedFd, null);
    Object.assign(fs, original);
  }
  console.log(JSON.stringify({ samples }));
} finally { Object.assign(fs, original); await fsp.rm(root, { recursive: true, force: true }); }
console.log('Actual packed writer/loader covers large consecutive lists, exact windows, partial varints, block resets, short reads, EOF and checksums.');
