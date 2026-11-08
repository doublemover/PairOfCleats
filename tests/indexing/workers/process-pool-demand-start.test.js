#!/usr/bin/env node
import assert from 'node:assert/strict';
import { IndexerProcessPool } from '../../../src/index/build/workers/process-pool.js';
const task = id => ({ id, name: 'controlled', outputLimit: 1, buffer: Buffer.alloc(0) });
const pool = Object.create(IndexerProcessPool.prototype);
Object.assign(pool, { closed: false, maxThreads: 8, children: new Set(), pending: [task(1)], timeoutMs: 30000, metrics: { started: 0, peakRunningTasks: 0 }, generation: 1 });
let starts = 0; const sent = [];
pool.start = () => { starts += 1; pool.children.add({ ready: false, stopping: false, task: null }); };
pool.pump(); assert.equal(starts, 1);
const ready = { ready: true, stopping: false, task: null, child: { send: message => sent.push(message.taskId) } };
pool.children.add(ready); pool.pending.push(task(2));
try { pool.pump(); assert.deepEqual(sent, [1], 'ready children run before siblings initialize'); }
finally { if (ready.task?.timer) clearTimeout(ready.task.timer); }
assert.equal(starts, 1);
