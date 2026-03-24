#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { readCurrentBuildGeneration } from '../../../src/shared/indexing/build-pointer.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const cacheName = 'api-search-build-identity';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env, userConfig } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared',
  requiredModes: ['code']
});

const repoCacheRoot = getRepoCacheRoot(fixtureRoot, userConfig);
const currentInfo = readCurrentBuildGeneration({
  currentJsonPath: path.join(repoCacheRoot, 'builds', 'current.json'),
  repoCacheRoot,
  buildsRoot: path.join(repoCacheRoot, 'builds')
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  env
});

try {
  const response = await requestJson('POST', '/search', { query: 'return', mode: 'code', top: 3 }, serverInfo);
  assert.equal(response.status, 200);
  assert.equal(response.body?.ok, true);
  assert.equal(response.body?.result?.observability?.context?.buildId, currentInfo.buildId);
  assert.equal(
    response.body?.result?.observability?.context?.activeBuildRoot,
    currentInfo.activeRoot,
    'expected API search result observability to expose the active generation root'
  );
  assert.equal(
    response.body?.result?.observability?.context?.buildGenerationKey,
    currentInfo.generationKey,
    'expected API search result observability to expose the active generation key'
  );
} finally {
  await stop();
}

console.log('API search build identity observability test passed');
