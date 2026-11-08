import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { createPreCpuArtifactState, applyCachedResultToArtifacts } from '../../../src/index/build/file-processor/pre-cpu-state.js';
import { loadIncrementalState } from '../../../src/index/build/incremental.js';
import { createFileProcessorFixture, createFileProcessorForTest, createScannedFileEntry } from './file-processor-fixture.js';

for (const enabled of [true, false]) for (const cacheMode of ['hashed', 'unhashed', 'disabled']) {
  const { repoRoot } = await createFileProcessorFixture(`cached-text-replacement-${enabled}-${cacheMode}`);
  const file = path.join(repoRoot, 'source.js'), cache = new Map();
  const before = 'export const alpha = 1;\n', after = 'export const bravo = 2;\n';
  assert.equal(Buffer.byteLength(before), Buffer.byteLength(after));
  await fs.writeFile(file, before);
  await fs.utimes(file, 1000.123, 1000.123);
  const firstStat = await fs.stat(file);
  const state = await loadIncrementalState({ repoRoot, repoCacheRoot: path.join(repoRoot, 'cache'),
    mode: 'code', enabled, cacheSignature: 'source-replacement', tokenizationKey: 'fixture' });
  // The ordinary built-in JS parser supplies the independent emitted-name witness.
  const make = () => createFileProcessorForTest({ root: repoRoot, languageOptions: { treeSitter: { enabled: false } },
    overrides: { fileTextCache: cacheMode === 'disabled' ? null : cache, incrementalState: state } });
  const run = async () => make().processFile(createScannedFileEntry({ abs: file, rel: 'source.js', stat: await fs.stat(file) }), 0);
  const first = await run();
  assert.ok(first?.chunks.some(chunk => chunk.name === 'alpha'));
  if (first.manifestEntry) state.manifest.files['source.js'] = first.manifestEntry;
  if (cacheMode !== 'disabled') {
    assert.equal(cache.get('source.js').text, before);
    if (cacheMode === 'unhashed') delete cache.get('source.js').hash;
  }
  await fs.writeFile(file, after);
  await fs.utimes(file, firstStat.atime, firstStat.mtime);
  const current = await fs.stat(file);
  assert.equal(current.size, firstStat.size); assert.equal(current.mtimeMs, firstStat.mtimeMs);
  const second = await run();
  assert.equal(second.cached, false);
  assert.equal(second.fileInfo.hash, sha1(Buffer.from(after)));
  assert.ok(second.chunks.some(chunk => chunk.name === 'bravo'), 'actual CPU analysis must consume the newly admitted bytes');
  assert.ok(second.chunks.every(chunk => chunk.name !== 'alpha'));
  if (cacheMode === 'disabled') { assert.equal(cache.size, 0); continue; }
  const retained = cache.get('source.js');
  assert.equal(retained.text, after); assert.deepEqual(retained.buffer, Buffer.from(after));
  assert.equal(retained.hash, second.fileInfo.hash); assert.equal(retained.encoding, second.fileInfo.encoding);
}
console.log('Same-size/restored-mtime replacement keeps CPU text, source hash and retained cache bytes coherent.');

const stat = { size: 3, mtimeMs: 1 };
for (const cached of ['legacy', { text: 'old', size: 3, mtimeMs: 0 }]) {
  const result = createPreCpuArtifactState({ fileTextCache: new Map([['a.js', cached]]), relKey: 'a.js', fileStat: stat });
  assert.equal(result.text, null); assert.equal(result.fileBuffer, null);
}
for (const text of ['', 'same']) {
  const bytes = Buffer.from(text), hash = sha1(bytes), encoding = 'utf8';
  const sourceStat = { size: bytes.length, mtimeMs: 1 };
  const state = createPreCpuArtifactState({ fileTextCache: new Map([['a.js', {
    text, buffer: bytes, hash, encoding, ...sourceStat }]]), relKey: 'a.js', fileStat: sourceStat });
  applyCachedResultToArtifacts({ artifacts: state, cachedResult: { buffer: Buffer.from(bytes), fileHash: hash, cachedBundle: null } });
  assert.equal(state.text, text, 'empty and ordinary decoded text retain exact unchanged-source admission');
  assert.equal(state.fileEncoding, encoding); assert.equal(state.fileHash, hash);
}
