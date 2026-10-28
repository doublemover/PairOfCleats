import assert from 'node:assert/strict';
import { applyBranchFilter } from '../../../src/retrieval/cli/branch-filter.js';

const messages = [], log = console.log, error = console.error;
console.log = value => messages.push(String(value)); console.error = value => messages.push(String(value));
const input = { branchFilter: 'requested', repoBranch: 'actual', backendLabel: 'memory', emitOutput: true, jsonOutput: true };
try {
  const original = Object.freeze(Error('original backend close failed'));
  await assert.rejects(applyBranchFilter({ ...input, beforePublish: async () => { throw original; } }), error => error === original);
  assert.deepEqual(messages, [], 'a branch mismatch cannot publish empty success before failed cleanup');
  let release;
  const pending = applyBranchFilter({ ...input, beforePublish: () => new Promise(resolve => { release = resolve; }) });
  await Promise.resolve(); assert.deepEqual(messages, []); release();
  const result = await pending;
  assert.equal(result.matched, false); assert.equal(result.receipt.state, 'mismatch');
  const payload = JSON.parse(messages.join(''));
  for (const mode of ['code', 'prose', 'extractedProse', 'records']) assert.deepEqual(payload[mode], []);
  messages.length = 0;
  let closed = false;
  const matched = await applyBranchFilter({ ...input, repoBranch: 'requested', beforePublish: () => { closed = true; } });
  assert.equal(matched.matched, true); assert.equal(closed, false, 'matching queries retain backends for actual retrieval');
  assert.deepEqual(messages, []);
  const controller = new AbortController();
  await assert.rejects(applyBranchFilter({ ...input, signal: controller.signal, beforePublish: () => controller.abort() }));
  assert.deepEqual(messages, [], 'cancellation during cleanup cannot publish success');
} finally { console.log = log; console.error = error; }
console.log('Branch mismatch publishes complete empty mode arrays only after cleanup and cancellation settlement');
