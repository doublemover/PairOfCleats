#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { openSemanticFrontier } from '../../../src/index/semantic/frontier.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-frontier-'));
const filename = path.join(root, 'control.sqlite');
const inputHashes = ['a'.repeat(64)], policyHash = 'b'.repeat(64), targetSetHash = 'c'.repeat(64);
const task = { schemaVersion: 1, taskId: createSemanticTaskId({ kind: 'bind', inputHashes, policyHash, targetSetHash }),
  kind: 'bind', baseBuildId: 'base-1', sourceUnits: ['su1:' + 'd'.repeat(64)], inputHashes, policyHash,
  targetSetHash, targetsRef: 'immutable:targets', dependencies: [{ dependencyKey: 'project', expectedHash: 'e'.repeat(64) }],
  priority: 3, reason: 'provider_startup_deferred', coverageToProduce: ['bindings'] };
let store;
try {
  assert.deepEqual(openSemanticFrontier({ filename }), { available: false, reason: 'sqlite_control_store_unavailable' });
  store = openSemanticFrontier({ Database, filename, maxAttempts: 2, retryDelayMs: 10 });
  assert.throws(() => store.enqueue({ task, durableInputHashes: new Set() }), /durable/);
  assert.equal(store.enqueue({ task, durableInputHashes: new Set(inputHashes) }).state, 'pending');
  assert.equal(store.enqueue({ task, durableInputHashes: new Set(inputHashes) }).attempt, 0);
  assert.throws(() => store.enqueue({ task: { ...task, reason: 'changed' }, durableInputHashes: new Set(inputHashes) }), /Conflicting/);
  assert.deepEqual(store.leaseReady({ baseBuildId: 'base-1', owner: 'first', now: 10 }), []);
  assert.equal(store.getTask(task.taskId).state, 'blocked');
  const dependencyHashes = new Map([['project', 'e'.repeat(64)]]);
  const [lease] = store.leaseReady({ baseBuildId: 'base-1', owner: 'first', now: 20, leaseMs: 30, dependencyHashes });
  assert.equal(lease.attempt, 1);
  assert.deepEqual(store.leaseReady({ baseBuildId: 'base-1', owner: 'second', now: 21, dependencyHashes }), []);
  assert.throws(() => store.release({ taskId: task.taskId, owner: 'second', now: 22, reason: 'wrong' }), { code: 'ERR_SEMANTIC_LEASE_LOST' });
  await assert.rejects(store.acknowledgePublished({ taskId: task.taskId, owner: 'first', now: () => 23,
    publication: { manifestHash: 'f'.repeat(64), publishedBuildId: 'next', baseBuildId: 'wrong', inputHash: lease.inputHash }, verifyPublication: async () => true }), { code: 'ERR_SEMANTIC_PUBLICATION_REQUIRED' });
  store.close();
  store = openSemanticFrontier({ Database, filename, maxAttempts: 2 });
  const [recovered] = store.leaseReady({ baseBuildId: 'base-1', owner: 'second', now: 51, leaseMs: 100, dependencyHashes });
  assert.equal(recovered.attempt, 2, 'expired leases survive close and reopen');
  const publication = { taskId: task.taskId, policyHash, manifestHash: 'f'.repeat(64), publishedBuildId: 'next', baseBuildId: 'base-1', inputHash: recovered.inputHash };
  await assert.rejects(store.acknowledgePublished({ taskId: task.taskId, owner: 'second', now: () => 52, publication, verifyPublication: async () => false }), { code: 'ERR_SEMANTIC_PUBLICATION_REQUIRED' });
  assert.equal(store.getOutput(task.taskId), null);
  await store.acknowledgePublished({ taskId: task.taskId, owner: 'second', now: () => 52, publication, verifyPublication: async () => true });
  assert.equal(store.getTask(task.taskId).state, 'completed');
  assert.equal(store.getOutput(task.taskId).publishedBuildId, 'next');
  const target2 = '1'.repeat(64), retry = { ...task, dependencies: [], targetSetHash: target2,
    taskId: createSemanticTaskId({ kind: 'bind', inputHashes, policyHash, targetSetHash: target2 }) };
  store.enqueue({ task: retry, durableInputHashes: new Set(inputHashes) });
  store.leaseReady({ baseBuildId: 'base-1', owner: 'retry', now: 100 });
  store.release({ taskId: retry.taskId, owner: 'retry', now: 101, reason: 'io', transient: true });
  assert.deepEqual(store.leaseReady({ baseBuildId: 'base-1', owner: 'retry', now: 102 }), [], 'backoff prevents immediate retry');
  store.leaseReady({ baseBuildId: 'base-1', owner: 'retry', now: 1200 });
  assert.equal(store.release({ taskId: retry.taskId, owner: 'retry', now: 1201, reason: 'io', transient: true }).state, 'failed');
  const failed = store.getTask(retry.taskId);
  const recoveredReceipt = { taskId: retry.taskId, policyHash, baseBuildId: retry.baseBuildId,
    inputHash: failed.inputHash, manifestHash: '2'.repeat(64), publishedBuildId: 'committed-before-crash' };
  await store.reconcilePublished({ taskId: retry.taskId, publication: recoveredReceipt, verifyPublication: async () => true });
  assert.equal(store.getTask(retry.taskId).state, 'completed', 'already-published outputs recover even after retry exhaustion');
  await store.reconcilePublished({ taskId: retry.taskId, publication: recoveredReceipt, verifyPublication: async () => true });
  const other = path.join(root, 'retrieval.sqlite');
  const db = new Database(other); db.exec('CREATE TABLE chunk_meta(id INTEGER)'); db.close();
  assert.throws(() => openSemanticFrontier({ Database, filename: other }), { code: 'ERR_SEMANTIC_CONTROL_STORE_SCOPE' });
  console.log('durable semantic frontier leases, retries, generation publication and scope checks passed');
} finally { store?.close(); await fs.rm(root, { recursive: true, force: true }); }
