#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const key = Symbol.for('poc.tests.backend-variant-failures');
const url = new URL('../../../tools/build/embeddings/lancedb.js', import.meta.url).href;
const hooks = registerHooks({ load(target, context, nextLoad) {
  if (target === url) return { format: 'module', shortCircuit: true,
    source: `export const writeLanceDbIndex = request => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](request);` };
  return nextLoad(target, context);
} });
try {
  const { writeLanceDbBackends } = await import('../../../tools/build/embeddings/backends.js');
  for (const isolateFallback of [false, true]) {
    const calls = [], warnings = [];
    globalThis[key] = async request => {
      calls.push([request.variant, request.skipIsolate === true]);
      if (request.variant === 'merged') {
        if (isolateFallback && !request.skipIsolate) return { skipped: true, reason: 'isolate failed' };
        throw new Error('controlled merged failure');
      }
      return { skipped: false, count: 1 };
    };
    const results = await writeLanceDbBackends({ mode: 'code', lanceConfig: { enabled: true },
      vectors: { merged: [[1]], doc: [[2]], code: [[3]] }, warn: message => warnings.push(message) });
    assert.equal(results.merged, null);
    assert.equal(results.doc.count, 1);
    assert.equal(results.code.count, 1);
    assert.deepEqual(calls.map(([variant]) => variant), isolateFallback
      ? ['merged', 'merged', 'doc', 'code'] : ['merged', 'doc', 'code']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /code\/merged.*controlled merged failure/);
  }
} finally { hooks.deregister(); delete globalThis[key]; }
console.log('Independent LanceDB variants survive direct and isolate-fallback failures.');
