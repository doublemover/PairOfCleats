#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { planWorkspaceAuthoring, applyWorkspaceAuthoring } from '../../tools/workspace/author.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'workspace-authoring-preview');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  const first = path.join(root, 'repo one');
  const second = path.join(root, 'repo two');
  await fs.mkdir(first);
  await fs.mkdir(second);
  const file = path.join(root, 'workspace.jsonc');
  const plan = planWorkspaceAuthoring({ workspacePath: file, roots: [first, second], aliases: ['one', 'two'] });
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  assert.equal(plan.repos.length, 2);
  assert.equal((await applyWorkspaceAuthoring(plan)).ok, true);
  assert.equal(loadWorkspaceConfig(file).repos.length, 2);
  assert.throws(() => planWorkspaceAuthoring({ workspacePath: file, roots: [first] }), /already exists/);
  assert.throws(() => planWorkspaceAuthoring({ workspacePath: file, operation: 'add', roots: [first] }), /Duplicate|duplicate/);
  const third = path.join(root, 'third');
  await fs.mkdir(third);
  const add = planWorkspaceAuthoring({ workspacePath: file, operation: 'add', roots: [third], aliases: ['three'] });
  await fs.appendFile(file, '\n// concurrent edit\n');
  await assert.rejects(applyWorkspaceAuthoring(add), /changed/);
  assert.equal(loadWorkspaceConfig(file).repos.length, 2);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Workspace authoring previews canonical identities and rejects stale writes.');
