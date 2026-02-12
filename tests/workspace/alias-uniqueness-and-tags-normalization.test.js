#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig, WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-alias-tags-'));
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const duplicateAliasFile = path.join(tempRoot, 'workspace-dup-alias.jsonc');
const normalizeTagsFile = path.join(tempRoot, 'workspace-tags.jsonc');

await fs.mkdir(repoA, { recursive: true });
await fs.mkdir(repoB, { recursive: true });
await fs.writeFile(path.join(repoA, '.pairofcleats.json'), '{}', 'utf8');
await fs.writeFile(path.join(repoB, '.pairofcleats.json'), '{}', 'utf8');

await fs.writeFile(duplicateAliasFile, `{
  "schemaVersion": 1,
  "repos": [
    { "root": "./repo-a", "alias": "Core" },
    { "root": "./repo-b", "alias": "core" }
  ]
}`, 'utf8');

assert.throws(() => loadWorkspaceConfig(duplicateAliasFile), (error) => {
  assert.equal(error.code, WORKSPACE_ERROR_CODES.DUPLICATE_ALIAS);
  return true;
});

await fs.writeFile(normalizeTagsFile, `{
  "schemaVersion": 1,
  "defaults": { "tags": [" Team ", "team", ""] },
  "repos": [
    { "root": "./repo-a", "alias": "   ", "tags": ["Service", " service ", "", "CORE"] },
    { "root": "./repo-b" }
  ]
}`, 'utf8');

const resolved = loadWorkspaceConfig(normalizeTagsFile);
assert.equal(resolved.repos[0].alias, null, 'empty alias should normalize to null');
assert.deepEqual(resolved.repos[0].tags, ['core', 'service']);
assert.deepEqual(resolved.repos[1].tags, ['team'], 'defaults.tags should apply when entry omits tags');

console.log('workspace alias uniqueness and tags normalization test passed');
