#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { describeWorkspaceReadiness } from '../../tools/workspace/diagnostics.js';
import { WORKSPACE_INDEX_MODES } from '../../src/workspace/manifest.js';

const workspace = { workspacePath: path.resolve('workspace with spaces.jsonc'), repos: [
  { repoId: 'repo-a', alias: 'first', repoRootCanonical: '/selected/a', enabled: true },
  { repoId: 'repo-b', alias: 'second', repoRootCanonical: '/selected/b', enabled: true },
  { repoId: 'repo-c', alias: 'disabled', repoRootCanonical: '/selected/c', enabled: false }
] };
const manifest = { repos: workspace.repos.map(repo => ({ ...repo, indexes: Object.fromEntries(WORKSPACE_INDEX_MODES.map(mode => [mode,
  { availabilityReason: repo.repoId === 'repo-a' ? 'present' : mode === 'code' ? 'missing-index-dir' : 'compat-key-missing' }])) })) };
const diagnosis = describeWorkspaceReadiness(workspace, manifest);
assert.deepEqual(diagnosis.modes.code, { selected: 2, ready: 1, missing: 1, incompatible: 0, disabled: 1, state: 'incomplete' });
const ready = diagnosis.nextActions.find(entry => entry.repoId === 'repo-a' && entry.mode === 'code');
assert.equal(ready.state, 'ready');
assert.equal(ready.command, null, 'ready members receive validation, not unnecessary rebuild commands');
assert.equal(ready.validateCommand[ready.validateCommand.indexOf('--repo') + 1], '/selected/a');
const missing = diagnosis.nextActions.find(entry => entry.repoId === 'repo-b' && entry.mode === 'code');
assert.equal(missing.state, 'missing');
assert.equal(missing.command[missing.command.indexOf('--repo') + 1], '/selected/b');
for (const entry of diagnosis.nextActions.filter(entry => entry.repoId === 'repo-c')) {
  assert.equal(entry.state, 'disabled'); assert.equal(entry.command, null); assert.equal(entry.validateCommand, null);
}
const incompatible = diagnosis.nextActions.find(entry => entry.repoId === 'repo-b' && entry.mode === 'prose');
assert.equal(incompatible.state, 'incompatible');
assert.match(incompatible.consequence, /partial/);
for (const command of [diagnosis.nextCommands.search, diagnosis.nextCommands.build, missing.command, ready.validateCommand]) {
  assert.equal(path.isAbsolute(command[0]), true);
  assert.equal(path.isAbsolute(command[1]), true);
}
for (const repo of manifest.repos) for (const entry of Object.values(repo.indexes)) entry.availabilityReason = 'present';
const allReady = describeWorkspaceReadiness(workspace, manifest);
assert.equal(allReady.modes.code.state, 'ready');
assert.equal(allReady.nextActions.filter(entry => entry.command).length, 0);
assert.match(allReady.qualification, /first results.*not inferred/);
const empty = describeWorkspaceReadiness({ ...workspace, repos: [] }, { repos: [] });
assert.equal(empty.modes.code.state, 'no-members');
console.log('Workspace onboarding diagnoses member availability without claiming unperformed search validation.');
