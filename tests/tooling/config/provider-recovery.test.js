import assert from 'node:assert/strict';
import { buildProviderRecovery } from '../../../src/index/tooling/recovery.js';
const repo = 'C:/project with spaces';
assert.deepEqual(buildProviderRecovery({ enabled: true, status: 'ok' }, repo), []);
assert.deepEqual(buildProviderRecovery({ enabled: false, status: 'error' }, repo), []);
const actions = buildProviderRecovery({ id: 'pyright', enabled: true, status: 'error', checks: [
  { name: 'pyright-command', status: 'error' }, { name: 'workspace', status: 'error' }
] }, repo);
assert.deepEqual(actions.map((action) => action.code), ['provider-command', 'provider-workspace', 'verify-recovery']);
assert.equal(actions[1].argv[4], repo);
assert.ok(actions.every((action) => !action.argv.includes('--apply')));
console.log('provider recovery preserves repository arguments and offers non-mutating diagnostics');
