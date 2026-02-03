#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildIndex, search, status } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, '.testCache', 'core-api');

if (!fs.existsSync(fixtureRoot)) {
  console.error(`Fixture not found: ${fixtureRoot}`);
  process.exit(1);
}

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

await buildIndex(fixtureRoot, {
  mode: 'code',
  sqlite: false,
  stubEmbeddings: true,
  log: () => {}
});

const userConfig = loadUserConfig(fixtureRoot);
const indexDir = getIndexDir(fixtureRoot, 'code', userConfig);
const extractedProseDir = getIndexDir(fixtureRoot, 'extracted-prose', userConfig);
await fsPromises.rm(extractedProseDir, { recursive: true, force: true });
const chunkPath = path.join(indexDir, 'chunk_meta.json');
if (!fs.existsSync(chunkPath)) {
  console.error(`Core API test failed: missing ${chunkPath}`);
  process.exit(1);
}

const searchPayload = await search(fixtureRoot, { query: 'index', mode: 'code', json: true });
if (!searchPayload || !Array.isArray(searchPayload.code)) {
  console.error('Core API test failed: search payload missing code results.');
  process.exit(1);
}

const statusPayload = await status(fixtureRoot);
if (!statusPayload?.repo?.root) {
  console.error('Core API test failed: status payload missing repo root.');
  process.exit(1);
}

console.log('core api test passed');

