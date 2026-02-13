#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig, WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-repo-root-file-'));
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
const notDirectoryPath = path.join(tempRoot, 'repo-root.txt');

await fs.writeFile(notDirectoryPath, 'not a directory', 'utf8');
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "repos": [
    { "root": "./repo-root.txt" }
  ]
}`, 'utf8');

assert.throws(() => loadWorkspaceConfig(workspacePath), (error) => {
  assert.equal(error.code, WORKSPACE_ERROR_CODES.REPO_ROOT_NOT_DIRECTORY);
  assert.equal(error.field, 'root');
  return true;
});

console.log('workspace repo root must be directory test passed');
