import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertSummaryBuildCase } from './summary-build-case-helpers.js';
import { withTemporaryEnv } from '../../../helpers/test-env.js';

let fixtureRoot;
const failure = Object.assign(new Error('injected summary build rejection'), { code: 'ERR_SUMMARY_CONTROL' });
await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_CONFIG: 'injected-host-trust-must-not-leak' }, async () => {
  await assert.rejects(assertSummaryBuildCase({ cacheVariant: 'repo', sqliteMode: 'code', coreIndex: true,
    indexer: async repo => {
      fixtureRoot = path.dirname(repo);
      assert.equal(process.env.PAIROFCLEATS_TRUSTED_CONFIG, undefined);
      throw failure;
    } }), error => error === failure);
  assert.equal(process.env.PAIROFCLEATS_TRUSTED_CONFIG, 'injected-host-trust-must-not-leak');
});
assert.equal(fs.existsSync(fixtureRoot), false, 'rejection must reach fixture cleanup');
let cancellationSettled = false;
await assert.rejects(assertSummaryBuildCase({ cacheVariant: 'repo', sqliteMode: 'code', coreIndex: true,
  indexTimeoutMs: 20,
  indexer: async (repo, { abortSignal }) => {
    fixtureRoot = path.dirname(repo);
    await new Promise(resolve => abortSignal.addEventListener('abort', resolve, { once: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
    cancellationSettled = true;
  } }), error => error.code === 'ETIMEDOUT');
assert.equal(cancellationSettled, true, 'owned work must settle before cleanup and timeout rejection');
assert.equal(fs.existsSync(fixtureRoot), false, 'deadline must clean the fixture');
await assert.rejects(assertSummaryBuildCase({ cacheVariant: 'repo', sqliteMode: 'code', indexTimeoutMs: 20001 }), /never raise/);
console.log('Summary build rejection, bounded cancellation, environment and scratch ownership passed');
