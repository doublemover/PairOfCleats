#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsExistsIndex } from '../../../src/index/build/import-resolution/fs-exists-index.js';
import { normalizeRelPath } from '../../../src/index/build/import-resolution/path-utils.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-bloom-hash-work-'));
const paths = Array.from({ length: 128 }, (_, id) => `src/${['ASCII', 'café', '東京', '😀'][id % 4]}-${id}/file.js`);
const originalCharCode = String.prototype.charCodeAt;
const hash32 = (text, seed) => {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= originalCharCode.call(text, i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};
let activeText = null;
let characterReads = 0;
try {
  const index = await createFsExistsIndex({ root, entries: paths.map((rel) => ({ rel })),
    resolverPlugins: { fsExistsIndex: { dirConcurrency: 1, maxScanFiles: 256 } } });
  assert.equal(index.complete, true);
  assert.equal(index.indexedCount, paths.length);
  // Reconstruct the unchanged seed/bit contract without using the production helper.
  const bits = new Set();
  const seeds = [0x811c9dc5, 0x27d4eb2f, 0x9e3779b1];
  for (const rel of paths) for (const seed of seeds) bits.add(hash32(rel, seed) & (index.bloomBits - 1));
  const expectedBloom = (rel) => seeds.every((seed) => bits.has(hash32(rel, seed) & (index.bloomBits - 1)));
  const known = new Set(paths);
  const candidates = [...paths, ...Array.from({ length: 4096 }, (_, id) => `src/missing-${id}/file.js`)];
  let bloomFalsePositives = 0;
  String.prototype.charCodeAt = function (offset) {
    if (String(this) === activeText) characterReads += 1;
    return originalCharCode.call(this, offset);
  };
  for (const candidate of candidates) {
    activeText = normalizeRelPath(candidate);
    characterReads = 0;
    const mightContain = expectedBloom(activeText);
    const expected = known.has(activeText) ? 'present' : 'absent';
    assert.equal(index.lookup(candidate), expected, 'exact membership still rejects Bloom false positives');
    if (mightContain && expected === 'absent') bloomFalsePositives += 1;
    assert.equal(characterReads, activeText.length * (mightContain ? 2 : 1),
      'Bloom hashes share one UTF-16 pass; exact verification remains a separate unchanged hash');
  }
  assert.ok(bloomFalsePositives > 0, 'fixture exercises the unchanged exact-check path for Bloom false positives');
  activeText = 'node_modules/ignored.js';
  characterReads = 0;
  assert.equal(index.lookup(activeText), 'unknown');
  assert.equal(characterReads, 0);
  assert.equal(index.lookup('./src/ASCII-0/file.js'), 'present');
  assert.equal(index.lookup('src\\ASCII-0\\file.js'), 'present');
  String.prototype.charCodeAt = originalCharCode;
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src/scanned.js'), '');
  await fs.writeFile(path.join(root, 'root.js'), '');
  const scanned = await createFsExistsIndex({ root,
    resolverPlugins: { fsExistsIndex: { dirConcurrency: 1 } } });
  assert.equal(scanned.lookup('src/scanned.js'), 'present');
  assert.equal(scanned.lookup('absent.js'), 'absent');
  const truncated = await createFsExistsIndex({ root, entries: [{ rel: 'src/scanned.js' }],
    resolverPlugins: { fsExistsIndex: { dirConcurrency: 1, maxScanFiles: 1 } } });
  assert.equal(truncated.complete, false);
  assert.equal(truncated.lookup('src/scanned.js'), 'present');
  assert.equal(truncated.lookup('absent.js'), 'unknown');
  const errored = await createFsExistsIndex({ root: path.join(root, 'root.js') });
  assert.equal(errored.complete, false);
  assert.equal(errored.lookup('absent.js'), 'unknown');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => createFsExistsIndex({ root, abortSignal: controller.signal }),
    (error) => error?.code === 'ABORT_ERR');
  console.log(`Filesystem Bloom hashing work passed: ${candidates.length} membership/hash-decision cases,${bloomFalsePositives} false positives exact-checked,3 to1 Bloom character passes`);
} finally {
  String.prototype.charCodeAt = originalCharCode;
  await fs.rm(root, { recursive: true, force: true });
}
