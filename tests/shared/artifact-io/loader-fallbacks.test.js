import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'artifact-io', 'loader-hardening');
const testRoot = path.join(root, '.testCache', 'loader-fallbacks');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

const fallbackDir = path.join(testRoot, 'fallback-json');
await fs.mkdir(fallbackDir, { recursive: true });
await fs.writeFile(
  path.join(fallbackDir, 'sample.json'),
  JSON.stringify([{ id: 1, value: 'ok' }], null, 2)
);
const fallbackRows = await loadJsonArrayArtifact(fallbackDir, 'sample', { strict: false });
assert.equal(fallbackRows.length, 1, 'expected json fallback to load rows');
assert.equal(fallbackRows[0]?.value, 'ok');

const partialDir = path.join(testRoot, 'partial-shards');
const partialPartsDir = path.join(partialDir, 'sample.parts');
await fs.mkdir(partialPartsDir, { recursive: true });
await fs.copyFile(
  path.join(fixtureRoot, 'partial.part-000000.jsonl'),
  path.join(partialPartsDir, 'sample.part-000000.jsonl')
);
await fs.copyFile(
  path.join(fixtureRoot, 'partial.part-000002.jsonl'),
  path.join(partialPartsDir, 'sample.part-000002.jsonl')
);

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

console.log('loader fallbacks test passed');
