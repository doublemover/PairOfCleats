#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveManifestArtifactSources } from '../../../src/shared/artifact-io/manifest.js';
import { prepareArtifactIoTestDir } from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('manifest-mmap-hot-layout', { root });

const hotPreferredManifest = {
  reader: { preferMmapHotLayout: true },
  pieces: [
    { name: 'sample', path: 'sample.json.gz', format: 'json', tier: 'cold' },
    {
      name: 'sample',
      path: 'sample.json',
      format: 'json',
      tier: 'hot',
      layout: { contiguous: true, order: 0 }
    }
  ]
};
const hotPreferred = resolveManifestArtifactSources({
  dir: testRoot,
  manifest: hotPreferredManifest,
  name: 'sample',
  strict: true
});
assert.equal(
  path.basename(hotPreferred?.paths?.[0] || ''),
  'sample.json',
  'expected strict canonical selection to prefer raw hot-layout entry'
);

const compressedPreferredManifest = {
  reader: { preferMmapHotLayout: false },
  pieces: [
    { name: 'sample', path: 'sample.json.gz', format: 'json', tier: 'cold' },
    {
      name: 'sample',
      path: 'sample.json',
      format: 'json',
      tier: 'hot',
      layout: { contiguous: true, order: 0 }
    }
  ]
};
const compressedPreferred = resolveManifestArtifactSources({
  dir: testRoot,
  manifest: compressedPreferredManifest,
  name: 'sample',
  strict: true
});
assert.equal(
  path.basename(compressedPreferred?.paths?.[0] || ''),
  'sample.json.gz',
  'expected canonical selection to prefer compressed variant when mmap-hot preference is disabled'
);

const orderedShardsManifest = {
  reader: { preferMmapHotLayout: true },
  pieces: [
    { name: 'rows', path: 'rows.parts/rows.part-000002.jsonl', format: 'jsonl', layout: { order: 2 } },
    { name: 'rows', path: 'rows.parts/rows.part-000000.jsonl', format: 'jsonl', layout: { order: 0 } },
    { name: 'rows', path: 'rows.parts/rows.part-000001.jsonl', format: 'jsonl', layout: { order: 1 } }
  ]
};
const orderedShards = resolveManifestArtifactSources({
  dir: testRoot,
  manifest: orderedShardsManifest,
  name: 'rows',
  strict: false
});
assert.deepEqual(
  orderedShards?.paths?.map((entry) => path.basename(entry)),
  ['rows.part-000000.jsonl', 'rows.part-000001.jsonl', 'rows.part-000002.jsonl'],
  'expected manifest loader to preserve explicit layout order for sharded entries'
);

console.log('manifest mmap hot layout test passed');
