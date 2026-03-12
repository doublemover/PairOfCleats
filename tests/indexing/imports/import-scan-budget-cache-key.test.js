#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveBundleFilename, writeBundleFile } from '../../../src/shared/bundle-io.js';
import { sha1 } from '../../../src/shared/hash.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { readCachedImports } from '../../../src/index/build/incremental.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-scan-budget-cache-key');
const repoRoot = path.join(tempRoot, 'repo');
const filePath = path.join(repoRoot, 'src', 'main.ts');
const relKey = 'src/main.ts';
const source = "import './client.codegen.ts';\n";

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(filePath), { recursive: true });
await fs.writeFile(filePath, source, 'utf8');

const stat = await fs.stat(filePath);
const fileHash = sha1(source);
const bundleDir = path.join(tempRoot, 'bundles');
await fs.mkdir(bundleDir, { recursive: true });
const bundleName = resolveBundleFilename(relKey, 'json');
const bundlePath = path.join(bundleDir, bundleName);
const matchingFingerprint = 'matching-scan-fingerprint';

await writeBundleFile({
  bundlePath,
  format: 'json',
  bundle: {
    file: relKey,
    hash: fileHash,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    chunks: [],
    fileRelations: {
      imports: ['./client.codegen.ts'],
      importScanFingerprint: matchingFingerprint
    }
  }
});

const manifest = {
  bundleFormat: 'json',
  files: {
    [relKey]: {
      hash: fileHash,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      bundle: bundleName
    }
  }
};

const matched = await readCachedImports({
  enabled: true,
  absPath: filePath,
  relKey,
  fileStat: stat,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  expectedImportScanFingerprint: matchingFingerprint
});
assert.deepEqual(matched, ['./client.codegen.ts'], 'expected matching import-scan fingerprint to reuse cached imports');

const mismatched = await readCachedImports({
  enabled: true,
  absPath: filePath,
  relKey,
  fileStat: stat,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  expectedImportScanFingerprint: 'different-fingerprint'
});
assert.equal(mismatched, null, 'expected mismatched import-scan fingerprint to invalidate cached imports');

const scanResult = await scanImports({
  files: [{ abs: filePath, rel: relKey, stat }],
  root: repoRoot,
  mode: 'code',
  languageOptions: {
    collectorScanBudget: {
      maxChars: 128
    }
  },
  importConcurrency: 1,
  incrementalState: {
    enabled: true,
    manifest,
    bundleDir,
    bundleFormat: 'json'
  },
  readCachedImportsFn: readCachedImports
});

assert.equal(typeof scanResult.importScanFingerprint, 'string', 'expected scan to expose an import-scan fingerprint');
const fingerprintVariant = await scanImports({
  files: [{ abs: filePath, rel: relKey, stat }],
  root: repoRoot,
  mode: 'code',
  languageOptions: {
    collectorScanBudget: {
      maxChars: 128
    },
    customCollectorOption: 'variant'
  },
  importConcurrency: 1,
  incrementalState: {
    enabled: false
  },
  readCachedImportsFn: readCachedImports
});
assert.notEqual(
  fingerprintVariant.importScanFingerprint,
  scanResult.importScanFingerprint,
  'expected collector option changes to invalidate the import-scan fingerprint'
);
assert.deepEqual(
  scanResult.importsByFile[relKey] || [],
  ['./client.codegen.ts'],
  'expected stale cached imports to be ignored and rebuilt from source scanning'
);

console.log('import scan budget cache key test passed');
