#!/usr/bin/env node
import assert from 'node:assert/strict';
import Piscina from 'piscina';
import { createIndexerWorkerPool, createIndexerWorkerPools } from '../../../src/index/build/workers/pool.js';

const queueSize = Object.getOwnPropertyDescriptor(Piscina.prototype, 'queueSize');
const destroy = Piscina.prototype.destroy;
const acquired = new Set();
const destroyCalls = new Map();
let failures = 0;
Object.defineProperty(Piscina.prototype, 'queueSize', { ...queueSize, get() {
  acquired.add(this);
  if (failures > 0) { failures--; throw new Error('injected initial metrics failure'); }
  return queueSize.get.call(this);
} });
Piscina.prototype.destroy = async function(...args) {
  destroyCalls.set(this, (destroyCalls.get(this) || 0) + 1);
  return destroy.apply(this, args);
};
const input = { config: { enabled: true, maxWorkers: 1, cleanupTimeoutMs: 100 },
  dictConfig: {}, postingsConfig: {}, log: () => {} };
try {
  failures = 1;
  assert.equal(await createIndexerWorkerPool(input), null, 'initialization failure retains existing fallback');
  const failed = [...acquired][0];
  assert.ok(failed, 'fixture fails after real pool acquisition');
  assert.equal(failed.threads.length, 0, 'fallback must not orphan the acquired worker');
  assert.equal(destroyCalls.get(failed), 1, 'existing destructor is reached once');

  failures = 1;
  const group = await createIndexerWorkerPools({ ...input, config: { ...input.config, maxWorkers: 2, splitByTask: true } });
  try {
    assert.ok(group.tokenizePool, 'other pool still provides the supported fallback');
    assert.equal(group.tokenizePool, group.quantizePool, 'both roles share the surviving owner');
    const failedSibling = [...acquired][1];
    assert.equal(failedSibling.threads.length, 0, 'failed sibling is cleaned before group fallback');
    assert.equal(destroyCalls.get(failedSibling), 1);
  } finally { await group.destroy(); }
  for (const pool of acquired) assert.equal(pool.threads.length, 0);

  // A failed cleanup remains visible instead of returning a deceptively safe
  // null fallback. Physically close first so failure injection leaves no leak.
  failures = 1;
  Piscina.prototype.destroy = async function(...args) {
    await destroy.apply(this, args);
    throw new Error('injected cleanup failure');
  };
  await assert.rejects(createIndexerWorkerPool(input), error => error instanceof AggregateError
    && error.errors.some(item => item.message === 'injected initial metrics failure')
    && error.errors.some(item => item.message === 'injected cleanup failure'));
} finally {
  Object.defineProperty(Piscina.prototype, 'queueSize', queueSize);
  Piscina.prototype.destroy = destroy;
  await Promise.all([...acquired].map(pool => destroy.call(pool)));
}
console.log('partially initialized real worker pools close acquired threads and preserve failure evidence');
