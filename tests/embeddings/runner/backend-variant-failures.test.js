#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const key = Symbol.for('poc.tests.backend-variant-failures');
const bridge = 'globalThis[Symbol.for(' + JSON.stringify(Symbol.keyFor(key)) + ')]';
const nativeUrl = new URL('../../../tools/build/embeddings/lancedb.js', import.meta.url).href;
const isolateUrl = new URL('../../../tools/build/embeddings/backend-isolate.js', import.meta.url).href;
const hooks = registerHooks({ load(target, context, nextLoad) {
  if (target === nativeUrl) return { format: 'module', shortCircuit: true,
    source: 'export const shouldIsolateLanceDb = config => config.isolate === true; export const writeLanceDbIndex = request => ' + bridge + '(request);' };
  if (target === isolateUrl) return { format: 'module', shortCircuit: true,
    source: 'export const runIsolatedBackendJobs = request => ' + bridge + '(request);' };
  return nextLoad(target, context);
} });
try {
  const { writeLanceDbBackends } = await import('../../../tools/build/embeddings/backends.js');
  for (const isolate of [false, true]) {
    const calls = [], warnings = [];
    globalThis[key] = async request => {
      if (Array.isArray(request.jobs)) {
        assert.equal(request.backend, 'lancedb');
        const results = {};
        for (const job of request.jobs) {
          try { results[job.target] = await globalThis[key]({ ...job.payload, variant: job.target }); }
          catch (error) { results[job.target] = { skipped: true, reason: 'isolate failed', error }; }
        }
        return { results, work: { childStarts: 1 } };
      }
      calls.push(request.variant);
      if (request.variant === 'merged') throw new Error('controlled merged failure');
      return { skipped: false, count: 1 };
    };
    const results = await writeLanceDbBackends({ mode: 'code', lanceConfig: { enabled: true, isolate },
      vectors: { merged: [[1]], doc: [[2]], code: [[3]] },
      vectorsPaths: { merged: 'merged.fixture', doc: 'doc.fixture', code: 'code.fixture' },
      warn: message => warnings.push(message) });
    if (isolate) assert.equal(results.merged.skipped, true);
    else assert.equal(results.merged, null);
    assert.equal(results.doc.count, 1); assert.equal(results.code.count, 1);
    assert.deepEqual(calls, ['merged', 'doc', 'code'], 'failed variants are never retried through another backend path');
    assert.equal(results.work.childStarts, isolate ? 1 : 0);
    assert.equal(warnings.length, 1); assert.match(warnings[0], /code\/merged.*controlled merged failure/);
  }
} finally { hooks.deregister(); delete globalThis[key]; }
// Real child protocol, crash attribution and unstarted-sibling continuation are
// covered by indexing/embeddings/backend-isolate-job-ownership.
console.log('Independent LanceDB variants survive direct and isolated failures without retrying failed work.');
