#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BUNDLE_CHECKSUM_SCHEMA_VERSION } from '../../../src/shared/bundle-io.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `bundle-checksum-schema-cutover-${process.pid}-${Date.now()}`);
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const incrementalDir = path.join(repoCacheRoot, 'incremental', 'code');
const manifestPath = path.join(incrementalDir, 'manifest.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(incrementalDir, { recursive: true });
await fs.writeFile(manifestPath, JSON.stringify({
  version: 5,
  signatureVersion: SIGNATURE_VERSION,
  mode: 'code',
  tokenizationKey: null,
  cacheSignature: null,
  signatureSummary: null,
  bundleFormat: 'json',
  files: {
    'src/index.js': {
      hash: 'abc',
      mtimeMs: 1,
      size: 1,
      bundles: ['deadbeef.json']
    }
  },
  shards: null
}, null, 2));

const logs = [];
try {
  const incremental = await loadIncrementalState({
    repoCacheRoot,
    mode: 'code',
    enabled: true,
    tokenizationKey: null,
    cacheSignature: null,
    cacheSignatureSummary: null,
    bundleFormat: 'json',
    log: (message) => logs.push(message)
  });
  assert.equal(incremental.manifest.bundleChecksumSchemaVersion, BUNDLE_CHECKSUM_SCHEMA_VERSION);
  assert.deepEqual(
    incremental.manifest.files,
    {},
    'expected checksum-schema cutover to invalidate stale incremental bundle entries'
  );
  assert.ok(
    logs.some((line) => line.includes('bundle checksum schema mismatch')),
    'expected checksum schema reset log message'
  );
  console.log('incremental bundle checksum schema cutover test passed');
} finally {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

