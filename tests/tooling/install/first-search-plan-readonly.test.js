#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFirstSearchPlan, applyFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'first-search-plan-readonly');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'target with spaces-'));
try {
  await fs.writeFile(path.join(root, 'example.py'), 'def example():\n  return 1\n');
  const config = '{\n  // Preserve this comment and custom policy\n  "quality": "auto"\n}\n';
  await fs.writeFile(path.join(root, '.pairofcleats.json'), config);
  const before = await fs.readdir(root, { recursive: true });
  const plan = await createFirstSearchPlan({ repoRoot: root });
  assert.equal(plan.choices.profile, 'sparse');
  assert.equal(plan.operations.some(step => step.id === 'models'), false);
  assert.equal(plan.operations.some(step => step.args.includes('npm')), false);
  assert.deepEqual(await fs.readdir(root, { recursive: true }), before);
  assert.equal(await fs.readFile(path.join(root, '.pairofcleats.json'), 'utf8'), config);
  await fs.writeFile(path.join(root, '.pairofcleats.json'), '{"quality":"fast"}');
  let executed = 0;
  await assert.rejects(applyFirstSearchPlan(plan, { execute: () => { executed++; return { ok: true }; } }), { code: 'ERR_SETUP_PLAN_STALE' });
  assert.equal(executed, 0);
  const fresh = await createFirstSearchPlan({ repoRoot: root });
  const applied = await applyFirstSearchPlan(fresh, { execute: () => { executed++; return { ok: true }; } });
  assert.equal(applied.state, 'complete');
  assert.equal(applied.completed.includes('config'), true);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.pairofcleats.json'), 'utf8')).quality, 'fast');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('First-search planning is read-only and rejects stale apply.');
