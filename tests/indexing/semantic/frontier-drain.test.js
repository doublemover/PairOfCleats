#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { openSemanticFrontier } from '../../../src/index/semantic/frontier.js';
import { drainSemanticFrontier } from '../../../src/index/semantic/frontier-drain.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core/index.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-frontier-drain-'));
const control = openSemanticFrontier({ Database, filename: path.join(root, 'control.sqlite') });
const scheduler = createBuildScheduler({ enabled: true, cpuTokens: 1, ioTokens: 1, memoryTokens: 2, queues: { relations: { priority: 1 } } });
const task = { schemaVersion: 1, kind: 'localFlow', baseBuildId: 'base', sourceUnits: ['su1:' + 'a'.repeat(64)],
  inputHashes: ['b'.repeat(64)], policyHash: 'c'.repeat(64), targetSetHash: 'd'.repeat(64), targetsRef: 'immutable:targets',
  dependencies: [], priority: 1, reason: 'bounded_deferred_analysis', coverageToProduce: ['localFlow'] };
task.taskId = createSemanticTaskId({ kind: task.kind, inputHashes: task.inputHashes, policyHash: task.policyHash, targetSetHash: task.targetSetHash });
let called = 0, published = false;
try {
  control.enqueue({ task, durableInputHashes: new Set(task.inputHashes) });
  const publishGeneration = async ({ task: selected, inputHash, output }) => {
    assert.equal(control.getTask(selected.taskId).state, 'leased');
    assert.equal(output.fact, 'derived'); published = true;
    return { taskId: selected.taskId, policyHash: selected.policyHash, baseBuildId: selected.baseBuildId, inputHash, manifestHash: 'e'.repeat(64), publishedBuildId: 'published' };
  };
  const options = { control, scheduler, baseBuildId: 'base', owner: 'coordinator', maxTasks: 2, maxMs: 1000, leaseMs: 5000,
    handlers: { localFlow: async () => { called += 1; return { fact: 'derived' }; } }, publishGeneration,
    verifyPublication: async () => published };
  const result = await drainSemanticFrontier(options);
  assert.equal(result.completed, 1); assert.equal(called, 1); assert.equal(result.status, 'complete');
  assert.equal(control.getTask(task.taskId).state, 'completed');
  const recovery = { ...task, targetSetHash: 'f'.repeat(64) };
  recovery.taskId = createSemanticTaskId({ kind: recovery.kind, inputHashes: recovery.inputHashes, policyHash: recovery.policyHash, targetSetHash: recovery.targetSetHash });
  control.enqueue({ task: recovery, durableInputHashes: new Set(task.inputHashes) });
  const recovered = await drainSemanticFrontier({ ...options, findPublished: async ({ task: selected, inputHash }) => ({
    taskId: selected.taskId, policyHash: selected.policyHash, baseBuildId: selected.baseBuildId, inputHash, manifestHash: 'e'.repeat(64), publishedBuildId: 'already-published' }) });
  assert.equal(recovered.recovered, 1); assert.equal(called, 1, 'recover published outputs without rerunning analysis');
  const unavailable = await drainSemanticFrontier({ control: { available: false } });
  assert.equal(unavailable.status, 'unavailable');
  console.log('explicit frontier drain uses existing scheduler and acknowledges only verified publication');
} finally { await scheduler.shutdown({ awaitRunning: true }); control.close(); await fs.rm(root, { recursive: true, force: true }); }
