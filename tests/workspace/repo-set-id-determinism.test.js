#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-reposet-'));
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const workspaceA = path.join(tempRoot, 'workspace-a.jsonc');
const workspaceB = path.join(tempRoot, 'workspace-b.jsonc');

await fs.mkdir(repoA, { recursive: true });
await fs.mkdir(repoB, { recursive: true });
await fs.writeFile(path.join(repoA, '.pairofcleats.json'), '{}', 'utf8');
await fs.writeFile(path.join(repoB, '.pairofcleats.json'), '{}', 'utf8');

await fs.writeFile(workspaceA, `{
  "schemaVersion": 1,
  "name": "First",
  "repos": [
    { "root": "./repo-a", "alias": "A", "tags": ["x"], "enabled": true, "priority": 0 },
    { "root": "./repo-b", "alias": "B", "tags": ["y"], "enabled": true, "priority": 0 }
  ]
}`, 'utf8');

await fs.writeFile(workspaceB, `{
  "schemaVersion": 1,
  "name": "Second",
  "repos": [
    { "root": "./repo-b", "alias": "Repo Bee", "tags": ["display"], "enabled": false, "priority": 999 },
    { "root": "./repo-a", "alias": "Repo Ay", "tags": ["metadata"], "enabled": true, "priority": -3 }
  ]
}`, 'utf8');

const resolvedA = loadWorkspaceConfig(workspaceA);
const resolvedB = loadWorkspaceConfig(workspaceB);

assert.equal(resolvedA.repoSetId, resolvedB.repoSetId, 'repoSetId should be order/display independent');
assert.notEqual(
  resolvedA.workspaceConfigHash,
  resolvedB.workspaceConfigHash,
  'workspaceConfigHash should include display metadata differences'
);

console.log('workspace repoSetId determinism test passed');
