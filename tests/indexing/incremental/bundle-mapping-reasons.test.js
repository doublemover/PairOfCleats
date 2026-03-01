#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeBundleFormat,
  readBundleFile,
  resolveBundleFormatFromName,
  writeBundleFile
} from '../../../src/shared/bundle-io.js';
import { getIncrementalPaths } from '../../../src/storage/sqlite/incremental.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { setupIncrementalRepo } from '../../helpers/sqlite-incremental.js';

const { root, repoRoot, env, userConfig, run, runCapture } = await setupIncrementalRepo({
  name: 'incremental-bundle-mapping-reasons'
});

const buildIndexPath = path.join(root, 'build_index.js');

run(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage2',
    '--no-sqlite',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage2 build',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const incrementalPaths = getIncrementalPaths(repoCacheRoot, 'code');
const manifestPath = incrementalPaths.manifestPath;
const bundleDir = incrementalPaths.bundleDir;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const firstManifestFile = Object.keys(manifest.files || {})[0];
assert.ok(firstManifestFile, 'expected at least one manifest file');
const firstEntry = manifest.files[firstManifestFile];
assert.ok(Array.isArray(firstEntry?.bundles) && firstEntry.bundles.length, 'expected manifest bundle entry');

const bundleFormat = normalizeBundleFormat(manifest.bundleFormat);
const sourceBundleName = firstEntry.bundles[0];
const sourceBundlePath = path.join(bundleDir, sourceBundleName);
const sourceRead = await readBundleFile(sourceBundlePath, {
  format: resolveBundleFormatFromName(sourceBundleName, bundleFormat)
});
assert.equal(sourceRead.ok, true, 'expected source bundle read to succeed');

const brokenChunk = {
  text: 'intentionally unmappable chunk',
  kind: 'paragraph',
  id: null,
  start: null,
  end: null,
  embedding_u8: null,
  embedding: null,
  segment: null,
  metaV2: null,
  file: null,
  docmeta: null
};
const brokenBundle = {
  ...(sourceRead.bundle || {}),
  file: firstManifestFile,
  chunks: [brokenChunk]
};

const sourceExt = path.extname(sourceBundleName) || '.json';
const brokenBundleName = `broken-no-parent${sourceExt}`;
const brokenBundlePath = path.join(bundleDir, brokenBundleName);
await writeBundleFile({
  bundlePath: brokenBundlePath,
  bundle: brokenBundle,
  format: resolveBundleFormatFromName(brokenBundleName, bundleFormat)
});

manifest.files['phantom/no-parent.js'] = {
  ...firstEntry,
  bundles: [brokenBundleName]
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const stage3Result = runCapture(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage3',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage3 build'
);

const output = `${stage3Result.stdout || ''}\n${stage3Result.stderr || ''}`;
assert.match(
  output,
  /embedding coverage .*skipped invalid=1\)/i,
  'expected embedding refresh to report one invalid incremental bundle mapping'
);

console.log('incremental bundle mapping reasons test passed');
