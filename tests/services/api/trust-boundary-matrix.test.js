#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildApiTrustBoundaryStatusView } from '../../../tools/api/trust-boundary.js';
import { prepareFixtureApiServerCohort, startApiServer } from '../../helpers/api-server.js';

const cohort = await prepareFixtureApiServerCohort({
  cacheName: 'api-trust-boundary-matrix', indexFixture: false
});
const start = options => startApiServer({ repoRoot: cohort.fixtureRoot, env: cohort.env, ...options });
const allowedExtraRoot = path.join(cohort.cacheRoot, 'allowed-extra');
await fsPromises.mkdir(allowedExtraRoot, { recursive: true });

const localUnauthenticated = await start({
  allowedRoots: [allowedExtraRoot],
  host: '127.0.0.1',
  authToken: '',
  allowUnauthenticated: true
});

try {
  assert.equal(localUnauthenticated.serverInfo?.trustBoundary?.bind?.scope, 'local');
  assert.equal(localUnauthenticated.serverInfo?.trustBoundary?.auth?.required, false);
  assert.equal(localUnauthenticated.serverInfo?.trustBoundary?.repos?.mode, 'allowlisted');
  assert.ok(
    Array.isArray(localUnauthenticated.serverInfo?.trustBoundary?.repos?.effectiveAllowedRepoRoots)
      && localUnauthenticated.serverInfo.trustBoundary.repos.effectiveAllowedRepoRoots.length >= 2,
    'expected local startup to report effective allowed repo roots'
  );
} finally {
  await localUnauthenticated.stop();
}

const remoteAuthenticated = await start({
  allowedRoots: [allowedExtraRoot],
  host: '0.0.0.0',
  authToken: 'remote-token'
});

try {
  const capabilities = await remoteAuthenticated.requestJson('GET', '/capabilities', null,
    { ...remoteAuthenticated.serverInfo, host: '127.0.0.1' });
  assert.equal(capabilities.status, 200,
    `expected authenticated remote /capabilities to succeed: ${JSON.stringify(capabilities.body)}`);
  assert.equal(remoteAuthenticated.serverInfo?.trustBoundary?.bind?.scope, 'non-local');
  assert.equal(remoteAuthenticated.serverInfo?.trustBoundary?.auth?.required, true);
  assert.deepEqual(
    capabilities.body?.trustBoundary,
    buildApiTrustBoundaryStatusView(remoteAuthenticated.serverInfo?.trustBoundary),
    'expected /capabilities to expose a redacted trust-boundary status view'
  );
} finally {
  await remoteAuthenticated.stop();
}

console.log('API trust boundary matrix test passed');
