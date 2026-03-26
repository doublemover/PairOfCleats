#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { readCurrentBuildGeneration } from '../../../src/shared/indexing/build-pointer.js';
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const cohort = await prepareFixtureApiServerCohort({
  cacheName: 'api-search-build-identity',
  fixtureOptions: {
    requiredModes: ['code']
  }
});
const { fixtureRoot, userConfig } = cohort;

const repoCacheRoot = getRepoCacheRoot(fixtureRoot, userConfig);
const currentInfo = readCurrentBuildGeneration({
  currentJsonPath: path.join(repoCacheRoot, 'builds', 'current.json'),
  repoCacheRoot,
  buildsRoot: path.join(repoCacheRoot, 'builds')
});

const { serverInfo, requestJson, stop } = await cohort.start();

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
  assert.equal(
    response.body?.result?.retrieval?.freshness?.activeGeneration?.buildId,
    currentInfo.buildId,
    'expected API retrieval metadata to expose the active build id'
  );
  assert.equal(
    response.body?.result?.retrieval?.freshness?.activeGeneration?.activeBuildRoot,
    currentInfo.activeRoot,
    'expected API retrieval metadata to expose the active build root'
  );
  assert.equal(
    response.body?.result?.retrieval?.freshness?.activeGeneration?.buildGenerationKey,
    currentInfo.generationKey,
    'expected API retrieval metadata to expose the active generation key'
  );
} finally {
  await stop();
}

console.log('API search build identity observability test passed');
