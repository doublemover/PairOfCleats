#!/usr/bin/env node
import path from 'node:path';
import assert from 'node:assert/strict';
import { CLANGD_STORAGE_ESTIMATE, CLANGD_RELEASE_INDEX_URL, resolveClangdArchiveTarget } from '../../../src/shared/managed-clangd.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const env = applyTestEnv({ syncProcess: false });
const result = runNode([
  path.join(root, 'tools', 'tooling', 'install.js'),
  '--root', fixtureRoot,
  '--tools', 'clangd',
  '--dry-run',
  '--json'
], 'tooling install dry-run', root, env, { stdio: 'pipe', allowFailure: true });

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('tooling-install did not return JSON');
  process.exit(1);
}

const results = payload.results || [];
const actions = payload.actions || [];
assert.equal(result.status, payload.preview.state === 'blocked-or-unqualified' ? 1 : 0);
assert.equal(payload.preview.execution, 'none');
assert.equal(payload.preview.writes, 'none');

const clangdResult = results.find((entry) => entry.id === 'clangd');
const clangdAction = actions.find((entry) => entry.id === 'clangd');
if (clangdResult?.status === 'already-installed') {
  assert.equal(clangdResult.probe?.ok, true);
  assert.equal(clangdAction, undefined);
} else if (resolveClangdArchiveTarget()) {
  assert.ok(clangdAction, 'supported targets plan the managed standalone recipe');
  assert.equal(clangdAction.kind, 'official-clangd-archive');
  assert.equal(clangdAction.command, null);
  assert.deepEqual(clangdAction.args, []);
  assert.equal(clangdAction.releaseSelection.indexUrl, CLANGD_RELEASE_INDEX_URL);
  const admission = payload.preview.entries.find(entry => entry.id === 'clangd').admission;
  assert.equal(admission.state, 'estimate-declared');
  assert.deepEqual(admission.writes, CLANGD_STORAGE_ESTIMATE.writes.map(write => ({
    ...write, minimumFreeBytes: 0, hardBytes: null
  })));
} else {
  assert.ok(payload.preview.entries[0].blockers.some(blocker => blocker.code === 'selected-recipe-unavailable'));
  assert.equal(clangdAction, undefined);
}
assert.equal(payload.readiness.state, 'planned');
assert.equal(payload.readiness.ready, false, 'dry-run never claims installation readiness');

console.log('tooling install test passed');
