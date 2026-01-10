#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUserConfig } from '../tools/dict-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = path.join(root, 'tests', '.cache', 'config-deprecations');
const configPath = path.join(cacheRoot, '.pairofcleats.json');

await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const config = {
  sqlite: {
    dbPath: 'cache/index.db',
    annMode: 'extension'
  },
  indexing: {
    fileCaps: {
      defaults: { maxBytes: 123 },
      byExtension: { '.js': { maxLines: 10 } },
      byLang: { javascript: { maxLines: 11 } }
    }
  },
  cache: {
    runtime: {
      fileText: { maxMB: 1, ttlMS: 2500 }
    }
  }
};

await fs.writeFile(configPath, JSON.stringify(config, null, 2));

const loaded = loadUserConfig(cacheRoot);

if (loaded.sqlite?.dbPath) {
  throw new Error('Expected sqlite.dbPath to be removed.');
}
if (loaded.sqlite?.annMode) {
  throw new Error('Expected sqlite.annMode to be removed.');
}
if (loaded.sqlite?.dbDir) {
  throw new Error('Expected sqlite.dbDir to be unset when only sqlite.dbPath is provided.');
}
if (loaded.sqlite?.vectorExtension?.annMode) {
  throw new Error('Expected sqlite.vectorExtension.annMode to be unset when only sqlite.annMode is provided.');
}
if (loaded.indexing?.fileCaps?.default) {
  throw new Error('Expected indexing.fileCaps.default to be unset when only defaults is provided.');
}
if (loaded.indexing?.fileCaps?.byExt) {
  throw new Error('Expected indexing.fileCaps.byExt to be unset when only byExtension is provided.');
}
if (loaded.indexing?.fileCaps?.byLanguage) {
  throw new Error('Expected indexing.fileCaps.byLanguage to be unset when only byLang is provided.');
}
const runtime = loaded.cache?.runtime?.fileText || {};
if (runtime.maxMb != null || runtime.ttlMs != null) {
  throw new Error('Expected cache.runtime.fileText maxMb/ttlMs to be unset when only maxMB/ttlMS is provided.');
}

console.log('Config deprecations test passed');
