#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFirstSearchPlan, applyFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'first-search-plan-readonly');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'target with spaces-'));
const trusted = path.join(suite, path.basename(root) + '-trusted.json');
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
  await assert.rejects(applyFirstSearchPlan(plan, { execute: () => { executed++; return { ok: true, status: 0 }; } }), { code: 'ERR_SETUP_PLAN_STALE' });
  assert.equal(executed, 0);
  const fresh = await createFirstSearchPlan({ repoRoot: root });
  const applied = await applyFirstSearchPlan(fresh, { execute: () => { executed++; return { ok: true, status: 0 }; } });
  assert.equal(applied.state, 'complete');
  assert.equal(applied.completed.includes('config'), true);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.pairofcleats.json'), 'utf8')).quality, 'fast');
  await fs.writeFile(trusted, JSON.stringify({ indexing: { embeddings: { enabled: true } } }));
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_CONFIG: trusted }, async () => {
    const blocked = await createFirstSearchPlan({ repoRoot: root });
    assert.equal(blocked.state, 'blocked');
    assert.ok(blocked.blockers.some(item => item.path === 'indexing.embeddings.enabled'));
    const beforeBlocked = await fs.readFile(path.join(root, '.pairofcleats.json'), 'utf8');
    const attempted = await applyFirstSearchPlan(blocked, { execute: () => { throw new Error('Blocked configuration must not execute'); } });
    assert.equal(attempted.completed.length, 0);
    assert.equal(await fs.readFile(path.join(root, '.pairofcleats.json'), 'utf8'), beforeBlocked);
  });
  const controller = new AbortController();
  controller.abort(new Error('fixture already cancelled'));
  const beforeCancelled = await fs.readdir(root);
  const cancelled = await applyFirstSearchPlan(await createFirstSearchPlan({ repoRoot: root }), { signal: controller.signal });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.validation, 'not-performed-cancelled-before-planning');
  assert.deepEqual(cancelled.pending[0], 'config');
  assert.deepEqual(await fs.readdir(root), beforeCancelled, 'pre-cancelled apply creates no lock or config file');
  const partial = await applyFirstSearchPlan(await createFirstSearchPlan({ repoRoot: root }), {
    execute: async () => { throw Object.assign(new Error('fixture operation failed after config'), { code: 'ERR_FIXTURE_STEP' }); }
  });
  assert.equal(partial.state, 'blocked');
  assert.deepEqual(partial.completed, ['config']);
  assert.equal(partial.failed.id, partial.pending[0]);
  let pendingError;
  let actualChildClosed = false;
  await assert.rejects(applyFirstSearchPlan(await createFirstSearchPlan({ repoRoot: root }), {
    execute: async () => { throw Object.assign(new Error('fixture child settlement pending'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => actualChildClosed }); }
  }), error => { pendingError = error; return error.cacheOwnershipPending === true; });
  assert.equal(pendingError.setupOutcome.state, 'settlement-pending');
  assert.deepEqual(pendingError.setupOutcome.completed, ['config']);
  assert.equal((await fs.stat(path.join(root, '.pairofcleats.json.setup-lock'))).isFile(), true);
  const pendingSession = pendingError.setupPlanSession;
  assert.throws(() => pendingSession.releaseAfterSettlement({ resourceId: 'wrong-owner', settled: true }), /unconfirmed/);
  assert.throws(() => pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true, pending: false }),
    error => error.cacheOwnershipPending === true && error.cacheOwnershipReleased() === false,
    'knowing the exact lock id cannot fabricate child settlement');
  actualChildClosed = true;
  assert.throws(() => pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true }), /unconfirmed/,
    'actual closure still requires an explicitly complete settlement receipt');
  await pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true, pending: false });
  assert.equal(await pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true, pending: false }), true,
    'duplicate settlement does not try to unlink an already released lock');
  await assert.rejects(fs.stat(path.join(root, '.pairofcleats.json.setup-lock')), { code: 'ENOENT' });
} finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(trusted, { force: true }); }
console.log('First-search planning is read-only and rejects stale apply.');
