#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildReadinessReceipt, buildSetupReadiness, buildToolInstallReadiness } from '../../../tools/setup/readiness.js';

const ready = { id: 'server', state: 'installed-and-verified', required: true, verificationLevel: 'initialize' };
assert.equal(buildReadinessReceipt({ items: [ready] }).state, 'ready');
for (const state of ['failed', 'missing', 'declined', 'manual-action-required', 'unverified', 'skipped']) {
  const receipt = buildReadinessReceipt({ items: [{ ...ready, state }] });
  assert.equal(receipt.state, 'blocked', state);
  assert.equal(receipt.exitCode, 1, state);
  assert.deepEqual(receipt.blockedIds, ['server']);
}
const optional = buildReadinessReceipt({ items: [ready, { id: 'optional', state: 'failed', required: false }] });
assert.equal(optional.state, 'degraded');
assert.equal(optional.exitCode, 0);
assert.deepEqual(optional.omittedIds, ['optional']);
assert.equal(buildReadinessReceipt({ items: [{ id: 'disabled', state: 'skipped' }] }).state, 'ready');
assert.equal(buildReadinessReceipt({ requiredIds: ['never-checked'] }).state, 'blocked');
assert.equal(buildReadinessReceipt({ items: [{ ...ready, state: 'planned' }], dryRun: true }).state, 'planned');
assert.equal(buildReadinessReceipt({ items: [{ ...ready, state: 'planned' }], dryRun: true }).ready, false);
assert.throws(() => buildReadinessReceipt({ items: [ready, ready] }), /unique/);
assert.throws(() => buildReadinessReceipt({ items: [{ ...ready, state: 'success-sounding-unknown' }] }), /Unknown/);
assert.equal(buildToolInstallReadiness([{ id: 'lua', status: 'installed' }]).state, 'blocked', 'a zero installer exit is not verification');
assert.equal(buildToolInstallReadiness([{ id: 'gopls', status: 'installed', path: '/managed/gopls', probe: { ok: true } }]).state, 'ready');
assert.equal(buildToolInstallReadiness([{ id: 'sdk', status: 'manual' }]).state, 'blocked');
assert.equal(buildToolInstallReadiness([{ id: 'gopls', status: 'missing-requirement', requires: 'go' }]).items[0].reason,
  'Missing installer prerequisite: go');
const optionalError = { steps: { dictionaries: { skipped: false, present: false } },
  errors: [{ step: 'dictionaries', message: 'download failed' }] };
assert.equal(buildSetupReadiness(optionalError).state, 'degraded');
assert.equal(buildSetupReadiness(optionalError, { requiredIds: ['dictionaries'] }).exitCode, 1);
assert.equal(buildSetupReadiness({ steps: { index: { ready: true, ok: false } } }).state, 'blocked',
  'old artifacts cannot erase a failed requested rebuild');
assert.equal(buildSetupReadiness({ steps: { models: { present: false, downloaded: true } } }).state, 'degraded',
  'download exit alone is not artifact presence');
assert.equal(buildSetupReadiness({ steps: { sqlite: { applicable: false, ok: true } } }).items[0].state, 'not-applicable');
console.log('Readiness receipts distinguish required blockers, optional omissions, planning, and executable verification.');
