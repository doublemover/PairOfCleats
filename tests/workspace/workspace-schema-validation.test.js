#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { validateWorkspaceConfigResolved } from '../../src/contracts/validators/workspace.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-schema-'));
const repo = path.join(tempRoot, 'repo');
await fs.mkdir(repo, { recursive: true });
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "repos": [{ "root": "./repo", "alias": "main" }]
}`, 'utf8');

const resolved = loadWorkspaceConfig(workspacePath);
const validation = validateWorkspaceConfigResolved(resolved);
assert.equal(validation.ok, true, validation.errors.join('; '));

console.log('workspace schema validation test passed');
