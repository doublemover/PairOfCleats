#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig, WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';
import { normalizeIdentityPath } from '../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-canonical-'));
const repoRoot = path.join(tempRoot, 'repo');
const nested = path.join(repoRoot, 'src', 'nested');
const workspaceFile = path.join(tempRoot, 'workspace.jsonc');

await fs.mkdir(nested, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), '{}', 'utf8');

await fs.writeFile(workspaceFile, `{
  "schemaVersion": 1,
  "repos": [
    { "root": "./repo" },
    { "root": "./repo/src/nested" }
  ]
}`, 'utf8');

assert.throws(() => loadWorkspaceConfig(workspaceFile), (error) => {
  assert.equal(error.code, WORKSPACE_ERROR_CODES.DUPLICATE_REPO_ROOT);
  return true;
});

const winPathA = normalizeIdentityPath('C:\\Repo\\Svc', { platform: 'win32' });
const winPathB = normalizeIdentityPath('c:\\repo\\svc', { platform: 'win32' });
assert.equal(winPathA, winPathB, 'win32 canonicalization should be case-insensitive');

if (process.platform === 'win32') {
  const casingVariant = path.join(tempRoot, 'workspace-casing.jsonc');
  const repoRootUpper = repoRoot.toUpperCase();
  await fs.writeFile(casingVariant, `{
  "schemaVersion": 1,
  "repos": [
    { "root": "${repoRoot.replace(/\\/g, '\\\\')}" },
    { "root": "${repoRootUpper.replace(/\\/g, '\\\\')}" }
  ]
}`, 'utf8');
  assert.throws(() => loadWorkspaceConfig(casingVariant, { platform: 'win32' }), (error) => {
    assert.equal(error.code, WORKSPACE_ERROR_CODES.DUPLICATE_REPO_ROOT);
    return true;
  });
}

console.log('workspace repo canonicalization dedupe test passed');
