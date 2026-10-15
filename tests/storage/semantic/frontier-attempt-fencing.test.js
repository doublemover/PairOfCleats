import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { openSemanticFrontier } from '../../../src/index/semantic/frontier.js';
import { runSemanticTaskBatch } from '../../../src/index/semantic/frontier-execution.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-frontier-attempt-'));
const filename = path.join(root, 'control.sqlite');
const taskFor = target => {
  const task = { schemaVersion: 1, kind: 'bind', baseBuildId: 'base', sourceUnits: ['su1:' + 'a'.repeat(64)],
    inputHashes: ['b'.repeat(64)], policyHash: 'c'.repeat(64), targetSetHash: target.repeat(64),
    targetsRef: 'immutable:targets', dependencies: [], priority: 1, reason: 'attempt-fixture', coverageToProduce: ['bindings'] };
  const { kind, inputHashes, policyHash, targetSetHash } = task;
  return { ...task, taskId: createSemanticTaskId({ kind, inputHashes, policyHash, targetSetHash }) };
};
const receipt = (task, lease) => ({ taskId: task.taskId, policyHash: task.policyHash, baseBuildId: task.baseBuildId,
  inputHash: lease.inputHash, manifestHash: 'f'.repeat(64), publishedBuildId: 'published' });
const lost = { code: 'ERR_SEMANTIC_LEASE_LOST' };
let control;
try {
  control = openSemanticFrontier({ Database, filename });
  const task = taskFor('d'), owner = 'reused-owner';
  control.enqueue({ task, durableInputHashes: new Set(task.inputHashes) });
  const [first] = control.leaseReady({ baseBuildId: 'base', taskId: task.taskId, owner, now: 10, leaseMs: 30 });
  const [second] = control.leaseReady({ baseBuildId: 'base', taskId: task.taskId, owner, now: 41, leaseMs: 100 });
  assert.equal(first.attempt, 1); assert.equal(second.attempt, 2);
  const stale = { taskId: task.taskId, owner, attempt: first.attempt, now: 42 };
  assert.throws(() => control.renew({ ...stale, leaseMs: 100 }), lost);
  assert.throws(() => control.release({ ...stale, reason: 'stale-cancellation', cancelled: true }), lost);
  let verified = false;
  await assert.rejects(control.acknowledgePublished({ ...stale, now: () => 42, publication: receipt(task, first),
    verifyPublication: async () => { verified = true; return true; } }), lost);
  assert.equal(verified, false, 'stale attempts cannot reach publication verification');
  const { descriptor: _descriptor, ...secondRow } = second;
  assert.deepEqual(control.getTask(task.taskId), secondRow, 'stale calls preserve every newer lease field');
  assert.throws(() => control.renew({ taskId: task.taskId, owner, now: 42 }), lost, 'attempt omission has no compatibility fallback');
  control.renew({ taskId: task.taskId, owner, attempt: second.attempt, now: 43, leaseMs: 100 });
  control.close(); control = openSemanticFrontier({ Database, filename });
  assert.throws(() => control.release({ ...stale, now: 44, reason: 'late-restart-cancellation', cancelled: true }), lost);
  assert.equal(control.release({ taskId: task.taskId, owner, attempt: second.attempt, now: 44,
    reason: 'current-cancellation', cancelled: true }).state, 'cancelled');

  const asynchronous = taskFor('e');
  control.enqueue({ task: asynchronous, durableInputHashes: new Set(asynchronous.inputHashes) });
  const [before] = control.leaseReady({ baseBuildId: 'base', taskId: asynchronous.taskId, owner, now: 10, leaseMs: 30 });
  let clock = 20, during;
  await assert.rejects(control.acknowledgePublished({ taskId: asynchronous.taskId, owner, attempt: before.attempt,
    now: () => clock, publication: receipt(asynchronous, before), verifyPublication: async () => {
      [during] = control.leaseReady({ baseBuildId: 'base', taskId: asynchronous.taskId, owner, now: 41, leaseMs: 100 });
      clock = 42; return true;
    } }), lost);
  assert.equal(control.getTask(asynchronous.taskId).attempt, during.attempt);
  assert.equal(control.getOutput(asynchronous.taskId), null, 'asynchronous verification cannot acknowledge a replacement attempt');

  const owners = [], releases = [], selected = [{ task, phase: 'bindings', policy: { executionMode: 'eager', enrichment: { bindings: 'eager' } } }];
  const executionFailure = Object.assign(new Error('owned fixture failure'), { code: 'ERR_FIXTURE_EXECUTION' });
  for (let index = 0; index < 2; index += 1) await assert.rejects(runSemanticTaskBatch({
    state: { semanticFactsByFile: new Map() }, runtime: { scheduler: { schedule: async (_queue, _resources, fn) => fn() } }, selected,
    openControl: async () => ({ available: true, leaseReady: input => {
      owners.push(input.owner); return [{ attempt: index + 1 }];
    }, release: input => releases.push(input), close() {} }),
    prepareExecution: async () => ({ decision: { admitted: true, request: {} }, verify: async () => {}, enter() {} }),
    fn: async () => { throw executionFailure; }
  }), { code: 'ERR_FIXTURE_EXECUTION' });
  assert.notEqual(owners[0], owners[1], 'same-task compiler batches get unique execution owners');
  assert.deepEqual(releases.map(row => row.attempt), [1, 2], 'batch cleanup uses each acquired attempt');
  assert.deepEqual(releases.map(row => row.owner), owners);
  console.log('Semantic attempt fencing rejects stale renew/release/publication across expiry and restart');
} finally { control?.close(); await fs.rm(root, { recursive: true, force: true }); }
