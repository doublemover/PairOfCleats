#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig, WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';
import { normalizeIdentityPath } from '../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-config-'));
const workspaceDir = path.join(tempRoot, 'workspace');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const workspaceFile = path.join(workspaceDir, '.pairofcleats-workspace.jsonc');

await fs.mkdir(path.join(repoA, 'nested'), { recursive: true });
await fs.mkdir(repoB, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
await fs.writeFile(path.join(repoA, '.pairofcleats.json'), '{}', 'utf8');
await fs.writeFile(path.join(repoB, '.pairofcleats.json'), '{}', 'utf8');

await fs.writeFile(workspaceFile, `{
  "schemaVersion": 1,
  "name": "  Workspace Parse  ",
  "cacheRoot": "../cache-root",
  "defaults": {
    "enabled": false,
    "priority": 7,
    "tags": [" Team ", "team"]
  },
  "repos": [
    { "root": "../repo-a/nested" },
    { "root": "../repo-b", "alias": "Repo-B", "enabled": true, "priority": 2, "tags": [" API ", "api", ""] }
  ]
}`, 'utf8');

const resolved = loadWorkspaceConfig(workspaceFile);
assert.equal(resolved.schemaVersion, 1);
assert.equal(resolved.name, 'Workspace Parse');
assert.equal(resolved.cacheRoot, normalizeIdentityPath(path.join(workspaceDir, '..', 'cache-root')));
assert.equal(resolved.repos.length, 2);
assert.equal(resolved.repos[0].enabled, false);
assert.equal(resolved.repos[0].priority, 7);
assert.deepEqual(resolved.repos[0].tags, ['team']);
assert.equal(resolved.repos[1].alias, 'Repo-B');
assert.deepEqual(resolved.repos[1].tags, ['api']);
assert.ok(resolved.repoSetId.startsWith('ws1-'));
assert.ok(resolved.workspaceConfigHash.startsWith('wsc1-'));

const unknownKeyFile = path.join(workspaceDir, 'workspace-unknown.jsonc');
await fs.writeFile(unknownKeyFile, `{
  "schemaVersion": 1,
  "repos": [{ "root": "../repo-a", "unknownField": true }]
}`, 'utf8');

assert.throws(() => loadWorkspaceConfig(unknownKeyFile), (error) => {
  assert.equal(error.code, WORKSPACE_ERROR_CODES.UNKNOWN_KEY);
  assert.equal(error.field, 'unknownField');
  return true;
});

console.log('workspace config parsing test passed');
