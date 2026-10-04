#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createLruCache } from '../../../src/shared/cache/lru.js';
import { BYTES_PER_MB, estimateFileTextBytes, estimateJsonBytes } from '../../../src/shared/cache/size.js';
import { createPreCpuArtifactState, writeArtifactsToFileTextCache } from '../../../src/index/build/file-processor/pre-cpu-state.js';

const text = 'alpha😀';
const buffer = Buffer.from(text, 'utf8');
const fileStat = { size: buffer.length, mtimeMs: 10 };
const artifacts = { text, fileBuffer: buffer, fileHash: 'fixture-hash', fileEncoding: 'utf8' };
const secondArtifacts = { ...artifacts, fileBuffer: Buffer.from(buffer) };
const cache = createLruCache({ name: 'dual-file-text', maxMb: 24 / BYTES_PER_MB,
  sizeCalculation: estimateFileTextBytes });
writeArtifactsToFileTextCache({ fileTextCache: cache, relKey: 'one.js', fileStat, artifacts });
writeArtifactsToFileTextCache({ fileTextCache: cache, relKey: 'two.js', fileStat, artifacts: secondArtifacts });
assert.equal(cache.size(), 1, 'the real cache writer admits both retained buffer and decoded text within its byte proxy');
assert.equal(cache.get('one.js'), null);
const retained = cache.get('two.js');
assert.equal(retained.buffer, secondArtifacts.fileBuffer, 'sizing must not copy or mutate the source buffer');
assert.equal(retained.text, text);
assert.equal(cache.cache.calculatedSize, 18);
assert.equal(cache.stats.evictions, 1);
const restored = createPreCpuArtifactState({ fileTextCache: cache, relKey: 'two.js', fileStat });
assert.equal(restored.fileBuffer, secondArtifacts.fileBuffer);
assert.equal(restored.text, text);
assert.equal(restored.fileHash, 'fixture-hash');

assert.equal(estimateFileTextBytes(buffer), 9);
assert.equal(estimateFileTextBytes(text), 9);
assert.equal(estimateFileTextBytes({ text }), 9);
assert.equal(estimateFileTextBytes({ buffer }), 9);
assert.equal(estimateFileTextBytes({ buffer, text }), 18);
assert.equal(estimateFileTextBytes({ data: buffer, text }), 18);
assert.equal(estimateFileTextBytes({ buffer, data: buffer, text }), 18, 'buffer/data remain alternative binary payload fields');
assert.equal(estimateFileTextBytes({ buffer, text: '' }), 10);
const emptyBuffer = { buffer: Buffer.alloc(0), text: 'fallback', extra: 1 };
assert.equal(estimateFileTextBytes(emptyBuffer), estimateJsonBytes(emptyBuffer), 'legacy empty-buffer fallback is retained');
const dynamic = { buffer, get text() { throw new Error('unused dynamic text field'); } };
assert.equal(estimateFileTextBytes(dynamic), 9, 'the extra estimate only reads an owned text data property');
assert.equal(estimateFileTextBytes(Object.assign(Object.create({ text }), { buffer })), 9);

const entryOnly = createLruCache({ name: 'entry-file-text', maxMb: 24 / BYTES_PER_MB,
  maxEntries: 2, sizeCalculation: estimateFileTextBytes });
for (const relKey of ['one.js', 'two.js']) {
  writeArtifactsToFileTextCache({ fileTextCache: entryOnly, relKey, fileStat, artifacts });
}
assert.equal(entryOnly.size(), 2, 'explicit entry-only policy is unchanged');
const disabled = createLruCache({ name: 'disabled-file-text', maxEntries: 0,
  maxMb: 24 / BYTES_PER_MB, sizeCalculation: estimateFileTextBytes });
writeArtifactsToFileTextCache({ fileTextCache: disabled, relKey: 'one.js', fileStat, artifacts });
assert.equal(disabled.size(), 0);
cache.clear();
entryOnly.clear();
console.log('File-text dual representation budget passed: real writer counts9 buffer+9 UTF8 text bytes; eviction/restore and legacy policies preserved');
