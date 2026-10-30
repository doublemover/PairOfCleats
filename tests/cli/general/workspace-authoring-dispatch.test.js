#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const checkout = process.cwd();
const suite = path.join(checkout, '.tmp', 'tasks', 'workspace-authoring-dispatch');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
const member = path.join(root, 'selected member');
const file = path.join(root, 'workspace.jsonc');
const env = applyTestEnv({ syncProcess: false });
const run = (args, allowFailure = false) => runNode(
  [path.join(checkout, 'bin/pairofcleats.js'), 'workspace', ...args],
  'workspace authoring dispatch', checkout, env,
  { stdio: 'pipe', timeoutMs: 5000, allowFailure }
);

try {
  await fs.mkdir(member);
  // Workspace membership authoring must not need the selected member's
  // operational config or wrapper-side runtime envelope to be valid.
  await fs.writeFile(path.join(member, '.pairofcleats.json'), '{ deliberately invalid');
  const preview = run(['init', '--workspace', file, '--repo', member, '--json']);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.operation, 'init');
  assert.equal(plan.workspacePath, file);
  assert.equal(plan.repos.length, 1);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(member), ['.pairofcleats.json']);

  const applied = run(['init', '--workspace', file, '--repo', member, '--apply', '--json']);
  assert.equal(JSON.parse(applied.stdout).ok, true);
  const before = await fs.readFile(file);
  const validated = JSON.parse(run(['validate', '--workspace', file, '--json']).stdout);
  assert.equal(validated.ok, true);
  assert.equal(validated.indexReadiness, 'not-probed');
  assert.deepEqual(await fs.readFile(file), before);

  const override = run(['validate', '--workspace', file, '--operation', 'init', '--json'], true);
  assert.notEqual(override.status, 0);
  assert.match(override.stderr || '', /Unknown flag: --operation/);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal(await fs.readFile(path.join(member, '.pairofcleats.json'), 'utf8'), '{ deliberately invalid');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('Workspace authoring dispatch preserves selected configuration and read-only previews.');
