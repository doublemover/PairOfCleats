import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
import { canonicalBundleSourceKey } from '../../../src/shared/bundle-source-key.js';
import { readCachedBundle, readCachedImports, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { readIncrementalBundleSnapshot, writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { collectLanguageImports } from '../../../src/index/language-registry.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';

applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-snapshot-bound-'));
try {
  const bundleDir = path.join(root, 'bundles'), absPath = path.join(root, 'source.js');
  const textA = "import './a.js';\nconst A = 1;", textB = "import './b.js';\nconst B = 2;";
  await fs.writeFile(absPath, textA);
  await fs.utimes(absPath, new Date(2000), new Date(2000));
  const fileStat = await fs.stat(absPath);
  const dependencies = { parse: 'p', lexical: 'l', enrichment: 'e', embeddings: 'm' };
  const write = text => {
    const imports = collectLanguageImports({ text, ext: '.js', relPath: 'source.js', mode: 'code' });
    return writeIncrementalBundle({ enabled: true, bundleDir, relKey: 'source.js',
      fileStat, fileHash: sha1(text), dependencySignatures: dependencies,
      fileChunks: [{ file: './source.js', text }],
      fileRelations: { imports, importExtraction: getImportExtraction(imports) }, bundleFormat: 'json' });
  };
  const entryA = await write(textA), entryB = await write(textB);
  assert.notDeepEqual(entryA.bundles, entryB.bundles, 'distinct source snapshots never overwrite one another');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: { 'source.js': entryA } };
  const input = { repoRoot: root, enabled: true, bundleDir, absPath, relKey: 'source.js', fileStat, manifest };
  assert.equal((await readCachedBundle(input)).cachedBundle.chunks[0].text, textA);
  assert.deepEqual(await readCachedImports(input), ['./a.js']);
  manifest.files['source.js'] = { ...entryA, bundles: entryB.bundles, bundleInventory: entryB.bundleInventory };
  assert.equal((await readCachedBundle(input)).cachedBundle, null, 'B bundle cannot satisfy A source snapshot');
  assert.equal(await readCachedImports(input), null);
  manifest.files['source.js'] = entryA;
  await assert.rejects(readCachedBundle({ ...input, manifest: { ...manifest, artifactSurfaceVersion: 'unsupported' } }),
    { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  const base = { file: 'source.js', hash: entryA.hash, size: fileStat.size, mtimeMs: fileStat.mtimeMs,
    dependencySignatures: dependencies, fileRelations: { imports: ['valid'] } };
  const snapshot = await writeIncrementalBundleSnapshot({ bundleDir, relKey: './source.js',
    bundles: [{ ...base, chunks: [{ file: 'source.js', text: 'first' }] },
      { ...base, chunks: [{ file: 'source.js', text: 'second' }] }] });
  const entry = { ...entryA, ...snapshot };
  const read = candidate => readIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey: 'source.js', entry: candidate });
  assert.deepEqual((await read(entry)).bundle.chunks.map(row => row.text), ['first', 'second']);
  for (const candidate of [
    { ...entry, bundles: [...entry.bundles].reverse() },
    { ...entry, bundles: [entry.bundles[0], entry.bundles[0]] },
    { ...entry, bundles: entry.bundles.slice(0, 1) },
    { ...entry, dependencySignatures: { ...dependencies, parse: 'changed' } },
    { ...entry, bundleInventory: entry.bundleInventory.map(row => ({ ...row, count: 3 })) }
  ]) assert.equal(await read(candidate), null);
  const second = path.join(bundleDir, entry.bundles[1]);
  const saved = await fs.readFile(second);
  await fs.copyFile(path.join(bundleDir, entryB.bundles[0]), second);
  assert.equal(await read(entry), null, 'mixed physical shard bytes fail closed');
  await fs.writeFile(second, saved);
  await fs.unlink(second);
  assert.equal(await read(entry), null, 'missing shard fails closed');
  assert.ok(await read({ ...entryA }), 'corruption does not invalidate an intact sibling snapshot');
  assert.equal(canonicalBundleSourceKey('.\\dir\\..\\source.js'), 'source.js');
  for (const value of ['../outside.js', '/outside.js', 'C:\\outside.js', 'bad\0path']) {
    assert.throws(() => canonicalBundleSourceKey(value), { code: 'ERR_BUNDLE_SOURCE_KEY' });
  }
  console.log('Manifest-bound immutable snapshots and canonical source identities passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
