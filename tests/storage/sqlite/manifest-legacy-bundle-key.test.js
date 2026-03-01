#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveManifestBundleNames } from '../../../src/shared/bundle-io.js';
import { validateIncrementalManifest } from '../../../src/storage/sqlite/build/manifest.js';

const legacyOnly = resolveManifestBundleNames({ bundle: 'abc123.json' });
assert.deepEqual(legacyOnly, ['abc123.json'], 'expected legacy `bundle` key to resolve as a single bundle name');

const preferModern = resolveManifestBundleNames({
  bundle: 'legacy.json',
  bundles: ['new-a.json', 'new-b.json']
});
assert.deepEqual(
  preferModern,
  ['new-a.json', 'new-b.json'],
  'expected explicit `bundles` list to take precedence when present'
);

const validation = validateIncrementalManifest({
  files: {
    'src/file.js': {
      hash: 'abc',
      mtimeMs: 1,
      size: 2,
      bundle: 'abc123.json'
    }
  }
});
assert.equal(validation.ok, true, 'expected incremental manifest validator to accept legacy `bundle` entries');

console.log('sqlite manifest legacy bundle key test passed');
