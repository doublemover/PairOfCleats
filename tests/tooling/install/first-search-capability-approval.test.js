#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFirstSearchPlan, applyFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'first-search-capability-approval');
await fs.mkdir(suite, { recursive: true });
const directory = await fs.mkdtemp(path.join(suite, 'case-'));
const root = path.join(directory, 'target with spaces');
await fs.mkdir(root);
try {
  const configPath = path.join(root, '.pairofcleats.json');
  const initial = '{\n // keep user policy\n "quality": "fast", "tooling": { "autoInstallOnDetect": true }\n}\n';
  await fs.writeFile(configPath, initial);
  await fs.writeFile(path.join(root, 'search-example.py'), 'def exact_target_symbol():\n  return 1\n');
  const plan = await createFirstSearchPlan({ repoRoot: root });
  assert.equal(plan.configPatch.tooling.autoInstallOnDetect, false);
  assert.equal(plan.capabilities.selected.mode, 'code');
  assert.equal(plan.capabilities.readiness.find(item => item.id === 'semantic-search').state, 'not-requested');
  assert.equal(plan.capabilities.tooling.execution, 'none');
  assert.equal(await fs.readFile(configPath, 'utf8'), initial);
  assert.deepEqual(await fs.readdir(root), ['.pairofcleats.json', 'search-example.py']);
  for (const command of Object.values(plan.commands)) {
    assert.equal(path.isAbsolute(command[0]), true);
    assert.equal(path.isAbsolute(command[1]), true);
    assert.equal(command[command.indexOf('--repo') + 1], plan.repoRoot);
  }
  for (const backend of ['memory', 'sqlite', 'lmdb']) {
    const selected = await createFirstSearchPlan({ repoRoot: root, backend });
    const args = selected.operations.find(step => step.id === 'index').args;
    assert.equal(args.includes(backend === 'sqlite' ? '--sqlite' : '--no-sqlite'), true);
    assert.equal(args.includes('--incremental'), true);
    assert.equal(selected.operations.some(step => step.id === 'lmdb'), backend === 'lmdb');
  }
  await assert.rejects(createFirstSearchPlan({ repoRoot: root, profile: 'sparse', model: 'unselected/model' }), /semantic profile/);
  const calls = [];
  const result = await applyFirstSearchPlan(plan, { execute: async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(args[args.indexOf('--repo') + 1], plan.repoRoot);
    return { ok: true, status: 0 };
  } });
  assert.equal(result.state, 'complete');
  assert.equal(result.firstSearch, 'not-performed');
  assert.equal(result.capabilities.find(item => item.id === 'sparse-search').state, 'index-validation-command-completed');
  assert.equal(calls.length, 2);
  assert.match(await fs.readFile(configPath, 'utf8'), /keep user policy/);
  const cancelled = new AbortController();
  const cancelledResult = await applyFirstSearchPlan(await createFirstSearchPlan({ repoRoot: root }), {
    signal: cancelled.signal, execute: async () => { cancelled.abort(); return { ok: true, status: 0 }; }
  });
  assert.equal(cancelledResult.state, 'cancelled');
  assert.deepEqual(cancelledResult.completed, ['config']);
  assert.equal(cancelledResult.pending[0], 'index');
  const changed = await applyFirstSearchPlan(await createFirstSearchPlan({ repoRoot: root }), {
    execute: async () => { await fs.writeFile(configPath, '{}'); return { ok: true, status: 0 }; }
  });
  assert.equal(changed.state, 'blocked');
  assert.deepEqual(changed.completed, ['config', 'index']);
  assert.equal(changed.failed.id, 'validate');
  const replace = await createFirstSearchPlan({ repoRoot: root });
  await fs.rename(root, path.join(directory, 'previous target'));
  await fs.mkdir(root);
  await fs.writeFile(configPath, '{}');
  await fs.writeFile(path.join(root, 'search-example.py'), 'def exact_target_symbol():\n  return 1\n');
  await assert.rejects(applyFirstSearchPlan(replace, { execute: () => assert.fail('replacement must invalidate approval') }), { code: 'ERR_SETUP_PLAN_STALE' });
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('First-search approvals preserve exact targets and report capability qualification.');
