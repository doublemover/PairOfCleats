import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { loadIncrementalState } from '../../../src/index/build/incremental.js';
import { createFileProcessorFixture, createFileProcessorForTest, createScannedFileEntry } from './file-processor-fixture.js';

for (const enabled of [true, false]) {
  const { repoRoot } = await createFileProcessorFixture(`cached-text-replacement-${enabled}`);
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
    overrides: { fileTextCache: cache, incrementalState: state } });
  const run = async () => make().processFile(createScannedFileEntry({ abs: file, rel: 'source.js', stat: await fs.stat(file) }), 0);
  const first = await run();
  assert.ok(first?.chunks.some(chunk => chunk.name === 'alpha'));
  if (first.manifestEntry) state.manifest.files['source.js'] = first.manifestEntry;
  assert.equal(cache.get('source.js').text, before);
  await fs.writeFile(file, after);
  await fs.utimes(file, firstStat.atime, firstStat.mtime);
  const current = await fs.stat(file);
  assert.equal(current.size, firstStat.size); assert.equal(current.mtimeMs, firstStat.mtimeMs);
  const second = await run();
  assert.equal(second.cached, false);
  assert.equal(second.fileInfo.hash, sha1(Buffer.from(after)));
  assert.ok(second.chunks.some(chunk => chunk.name === 'bravo'), 'actual CPU analysis must consume the newly admitted bytes');
  assert.ok(second.chunks.every(chunk => chunk.name !== 'alpha'));
  const retained = cache.get('source.js');
  assert.equal(retained.text, after); assert.deepEqual(retained.buffer, Buffer.from(after));
  assert.equal(retained.hash, second.fileInfo.hash); assert.equal(retained.encoding, second.fileInfo.encoding);
}
console.log('Same-size/restored-mtime replacement keeps CPU text, source hash and retained cache bytes coherent.');
