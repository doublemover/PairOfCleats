#!/usr/bin/env node
import path from 'node:path';
import assert from 'node:assert/strict';
import { resolveClangdArchiveTarget } from '../../../src/shared/managed-clangd.js';
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
], 'tooling install dry-run', root, env, { stdio: 'pipe' });

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('tooling-install did not return JSON');
  process.exit(1);
}

const results = payload.results || [];
const actions = payload.actions || [];

const clangdResult = results.find((entry) => entry.id === 'clangd');
const clangdAction = actions.find((entry) => entry.id === 'clangd');
if (clangdResult?.status === 'already-installed') {
  assert.equal(clangdResult.probe?.ok, true);
  assert.equal(clangdAction, undefined);
} else if (resolveClangdArchiveTarget()) {
  assert.ok(clangdAction, 'supported targets plan the managed standalone recipe');
  assert.equal(clangdAction.cmd, process.execPath);
  assert.ok(clangdAction.args[0].endsWith(path.join('tools', 'tooling', 'install-clangd.js')));
  const rootIndex = clangdAction.args.indexOf('--tooling-root');
  assert.ok(rootIndex >= 0 && path.isAbsolute(clangdAction.args[rootIndex + 1]));
} else {
  assert.equal(clangdResult?.status, 'manual');
  assert.equal(clangdAction, undefined);
}
assert.equal(payload.readiness.state, 'planned');
assert.equal(payload.readiness.ready, false, 'dry-run never claims installation readiness');

console.log('tooling install test passed');
