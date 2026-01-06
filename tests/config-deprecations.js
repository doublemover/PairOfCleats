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

const expectedDbDir = path.join(cacheRoot, 'cache');
if (loaded.sqlite?.dbDir !== expectedDbDir) {
  throw new Error(`Expected sqlite.dbDir to be ${expectedDbDir}, got ${loaded.sqlite?.dbDir}`);
}
if (loaded.sqlite?.vectorExtension?.annMode !== 'extension') {
  throw new Error('Expected sqlite.vectorExtension.annMode to be set from sqlite.annMode.');
}
if (!loaded.indexing?.fileCaps?.default) {
  throw new Error('Expected indexing.fileCaps.default to be set from defaults.');
}
if (!loaded.indexing?.fileCaps?.byExt?.['.js']) {
  throw new Error('Expected indexing.fileCaps.byExt to be set from byExtension.');
}
if (!loaded.indexing?.fileCaps?.byLanguage?.javascript) {
  throw new Error('Expected indexing.fileCaps.byLanguage to be set from byLang.');
}
const runtime = loaded.cache?.runtime?.fileText || {};
if (runtime.maxMb !== 1 || runtime.ttlMs !== 2500) {
  throw new Error('Expected cache.runtime.fileText maxMb/ttlMs to be normalized.');
}

console.log('Config deprecations test passed');
