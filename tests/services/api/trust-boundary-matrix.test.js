#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';

const cohort = await prepareFixtureApiServerCohort({
  cacheName: 'api-trust-boundary-matrix'
});
const allowedExtraRoot = path.join(cohort.cacheRoot, 'allowed-extra');
await fsPromises.mkdir(allowedExtraRoot, { recursive: true });

const expectStartupFailure = async (options, expectedMessage) => {
  let failed = false;
  try {
    await cohort.start(options);
  } catch (error) {
    failed = true;
    assert.match(String(error?.message || error), expectedMessage);
  }
  assert.equal(failed, true, `expected startup failure matching ${expectedMessage}`);
};

await expectStartupFailure({
  allowedRoots: [],
  host: '0.0.0.0',
  authToken: '',
  allowUnauthenticated: false,
  startupTimeoutMs: 5000
}, /requires PAIROFCLEATS_API_TOKEN|requires .*--auth-token/i);

await expectStartupFailure({
  allowedRoots: [],
  host: '0.0.0.0',
  authToken: '',
  allowUnauthenticated: true,
  startupTimeoutMs: 5000
}, /refuses --allow-unauthenticated/i);

await expectStartupFailure({
  allowedRoots: [],
  host: '0.0.0.0',
  authToken: 'remote-token',
  corsAllowAny: true,
  startupTimeoutMs: 5000
}, /refuses --cors-allow-any/i);

const localUnauthenticated = await cohort.start({
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

const remoteAuthenticated = await cohort.start({
  allowedRoots: [allowedExtraRoot],
  host: '0.0.0.0',
  authToken: 'remote-token'
});

try {
  const capabilities = await remoteAuthenticated.requestJson('GET', '/capabilities', null, remoteAuthenticated.serverInfo);
  assert.equal(capabilities.status, 200, 'expected authenticated remote /capabilities to succeed');
  assert.equal(remoteAuthenticated.serverInfo?.trustBoundary?.bind?.scope, 'non-local');
  assert.equal(remoteAuthenticated.serverInfo?.trustBoundary?.auth?.required, true);
  assert.equal(capabilities.body?.trustBoundary?.effectiveBoundary?.exposure, 'non-local');
  assert.equal(capabilities.body?.trustBoundary?.auth?.mode, 'token');
  assert.equal(capabilities.body?.trustBoundary?.repos?.mode, 'allowlisted');
  assert.ok(
    Array.isArray(capabilities.body?.trustBoundary?.workspaces?.policyRoots)
      && capabilities.body.trustBoundary.workspaces.policyRoots.length >= 2,
    'expected /capabilities to expose workspace policy roots'
  );
} finally {
  await remoteAuthenticated.stop();
}

console.log('API trust boundary matrix test passed');
