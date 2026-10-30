#!/usr/bin/env node
import assert from 'node:assert/strict';
import { prepareFixtureApiServerCohort, startApiServer } from '../../helpers/api-server.js';

const cohort = await prepareFixtureApiServerCohort({ cacheName: 'api-trust-boundary-rejections', indexFixture: false });
const start = options => startApiServer({ repoRoot: cohort.fixtureRoot, env: cohort.env, ...options });
const expectStartupFailure = async (options, expectedMessage) => {
  let failed = false;
  try {
    await start(options);
  } catch (error) {
    failed = true;
    assert.match(String(error?.message || error), expectedMessage);
  }
  assert.equal(failed, true, `expected startup failure matching ${expectedMessage}`);
};

await expectStartupFailure({ allowedRoots: [], host: '0.0.0.0', authToken: '',
  allowUnauthenticated: false, startupTimeoutMs: 5000 },
/requires PAIROFCLEATS_API_TOKEN|requires .*--auth-token/i);
await expectStartupFailure({ allowedRoots: [], host: '0.0.0.0', authToken: '',
  allowUnauthenticated: true, startupTimeoutMs: 5000 }, /refuses --allow-unauthenticated/i);
await expectStartupFailure({ allowedRoots: [], host: '0.0.0.0', authToken: 'remote-token',
  corsAllowAny: true, startupTimeoutMs: 5000 }, /refuses --cors-allow-any/i);
console.log('API non-local authentication and CORS startup rejections passed');
