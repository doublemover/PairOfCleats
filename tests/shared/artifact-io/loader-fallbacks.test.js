import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'artifact-io', 'loader-hardening');
const testRoot = await prepareArtifactIoTestDir('loader-fallbacks', { root });

const fallbackDir = path.join(testRoot, 'fallback-json');
await fs.mkdir(path.join(fallbackDir, 'pieces'), { recursive: true });
await fs.writeFile(
  path.join(fallbackDir, 'sample.json'),
  JSON.stringify([{ id: 1, value: 'ok' }], null, 2)
);
await assert.rejects(
  () => loadJsonArrayArtifact(fallbackDir, 'sample', { strict: false }),
  { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' },
  'expected hard cutover to reject unmanifested legacy JSON artifacts'
);

const partialDir = path.join(testRoot, 'partial-shards');
const partialPartsDir = path.join(partialDir, 'sample.parts');
await fs.mkdir(path.join(partialDir, 'pieces'), { recursive: true });
await fs.mkdir(partialPartsDir, { recursive: true });
await fs.copyFile(
  path.join(fixtureRoot, 'partial.part-000000.jsonl'),
  path.join(partialPartsDir, 'sample.part-000000.jsonl')
);
await fs.copyFile(
  path.join(fixtureRoot, 'partial.part-000002.jsonl'),
  path.join(partialPartsDir, 'sample.part-000002.jsonl')
);
await writePiecesManifest(partialDir, [
  { name: 'sample', path: 'sample.parts/sample.part-000000.jsonl' },
  { name: 'sample', path: 'sample.parts/sample.part-000002.jsonl' }
]);

await assert.rejects(
  () => loadJsonArrayArtifact(partialDir, 'sample', { strict: false }),
  (err) => err?.code === 'ERR_ARTIFACT_PARTS_MISSING' && /sample\.part-000001\.jsonl/.test(String(err?.message || '')),
  'expected partial shard set to fail with deterministic missing-shard error'
);

await assert.rejects(
  async () => {
    for await (const _row of loadJsonArrayArtifactRows(partialDir, 'sample', { strict: false })) {
      // consume rows
    }
  },
  (err) => err?.code === 'ERR_ARTIFACT_PARTS_MISSING' && /sample\.part-000001\.jsonl/.test(String(err?.message || '')),
  'expected streaming loader to fail with deterministic missing-shard error'
);

const multiSourceDir = path.join(testRoot, 'nonstrict-multi-source-json');
for (const part of ['000000', '000002']) {
  const file = path.join(partialPartsDir, `sample.part-${part}.jsonl`);
  await fs.rename(file, `${file}.bak`);
  for (const streaming of [false, true]) {
    await assert.rejects(async () => {
      if (!streaming) return loadJsonArrayArtifact(partialDir, 'sample', { strict: false });
      for await (const _row of loadJsonArrayArtifactRows(partialDir, 'sample', { strict: false })) { /* consume */ }
    }, error => error?.code === 'ERR_ARTIFACT_PARTS_MISSING' && /sample\.part-000001\.jsonl/.test(error.message),
    'supported backup selection cannot conceal a missing logical shard');
  }
}
for (const suffix of ['.gz', '.zst']) {
  const compressed = path.join(testRoot, `partial-compressed-${suffix.slice(1)}`);
  await fs.mkdir(compressed);
  const names = ['000000', '000002'].map(part => `sample.part-${part}.jsonl${suffix}`);
  for (const name of names) {
    const raw = Buffer.from('{"id":1}\n');
    await fs.writeFile(path.join(compressed, name), suffix === '.gz' ? gzipSync(raw) : zstdCompressSync(raw));
  }
  await fs.writeFile(path.join(compressed, 'sample.meta.json'), JSON.stringify({ format: 'jsonl-sharded', parts: names }));
  await writePiecesManifest(compressed, [...names.map(name => ({ name: 'sample', path: name, format: 'jsonl' })),
    { name: 'sample_meta', path: 'sample.meta.json', format: 'json' }]);
  for (const backupCount of [0, 1, 2]) {
    if (backupCount) await fs.rename(path.join(compressed, names[backupCount - 1]), path.join(compressed, names[backupCount - 1] + '.bak'));
    for (const strict of [false, true]) for (const streaming of [false, true]) {
      await assert.rejects(async () => {
        if (!streaming) return loadJsonArrayArtifact(compressed, 'sample', { strict });
        for await (const _row of loadJsonArrayArtifactRows(compressed, 'sample', { strict })) { /* consume */ }
      }, error => error.code === 'ERR_ARTIFACT_PARTS_MISSING' && error.message.includes('sample.part-000001.jsonl'),
      'compressed physical backup choices cannot change canonical gap admission');
    }
  }
}

await fs.mkdir(path.join(multiSourceDir, 'pieces'), { recursive: true });
await fs.writeFile(
  path.join(multiSourceDir, 'sample-a.json'),
  JSON.stringify([{ id: 1 }, { id: 2 }], null, 2)
);
await fs.writeFile(
  path.join(multiSourceDir, 'sample-b.json'),
  JSON.stringify([{ id: 3 }], null, 2)
);
await writePiecesManifest(multiSourceDir, [
  { name: 'sample', path: 'sample-a.json' },
  { name: 'sample', path: 'sample-b.json' }
]);

const mergedRows = await loadJsonArrayArtifact(multiSourceDir, 'sample', { strict: false });
assert.equal(Array.isArray(mergedRows), true, 'expected merged rows payload');
assert.equal(mergedRows.length, 3, 'expected non-strict loader to merge all json sources');

let streamedRows = 0;
for await (const _row of loadJsonArrayArtifactRows(multiSourceDir, 'sample', { strict: false })) {
  streamedRows += 1;
}
assert.equal(streamedRows, 3, 'expected streaming loader to iterate all non-strict json sources');

console.log('loader fallbacks test passed');
