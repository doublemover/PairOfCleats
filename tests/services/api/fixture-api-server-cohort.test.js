#!/usr/bin/env node
import assert from 'node:assert/strict';
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const sharedOne = await prepareFixtureApiServerCohort({
  cacheName: 'api-cohort-contract',
  fixtureOptions: {
    requiredModes: ['code']
  }
});
const sharedTwo = await prepareFixtureApiServerCohort({
  cacheName: 'api-cohort-contract',
  resetCache: false,
  fixtureOptions: {
    requiredModes: ['code']
  }
});

assert.equal(sharedOne.cohort.cacheScope, 'shared');
assert.equal(sharedOne.cacheRoot, sharedTwo.cacheRoot, 'expected shared cohort cache reuse');
assert.equal(sharedOne.fixtureRoot, sharedTwo.fixtureRoot, 'expected shared cohort fixture reuse');

const started = await sharedTwo.start();
try {
  const health = await started.requestJson('GET', '/health', null, started.serverInfo);
  assert.equal(health.status, 200, 'expected cohort-started API server to respond');
  assert.equal(health.body?.ok, true, 'expected healthy cohort response');
} finally {
  await started.stop();
}

let isolatedOne = null;
let isolatedTwo = null;
await withTemporaryEnv({ PAIROFCLEATS_TEST_CACHE_SUFFIX: 'api-cohort-one' }, async () => {
  isolatedOne = await prepareFixtureApiServerCohort({
    cacheName: 'api-cohort-isolated',
    cacheScope: 'isolated',
    resetCache: false,
    fixtureOptions: {
      requiredModes: ['code']
    }
  });
});
await withTemporaryEnv({ PAIROFCLEATS_TEST_CACHE_SUFFIX: 'api-cohort-two' }, async () => {
  isolatedTwo = await prepareFixtureApiServerCohort({
    cacheName: 'api-cohort-isolated',
    cacheScope: 'isolated',
    resetCache: false,
    fixtureOptions: {
      requiredModes: ['code']
    }
  });
});

assert.equal(isolatedOne?.cohort?.cacheScope, 'isolated');
assert.equal(isolatedTwo?.cohort?.cacheScope, 'isolated');
assert.notEqual(
  isolatedOne?.cacheRoot,
  isolatedTwo?.cacheRoot,
  'expected isolated cohort cache roots to stay distinct'
);

console.log('fixture api server cohort test passed');
