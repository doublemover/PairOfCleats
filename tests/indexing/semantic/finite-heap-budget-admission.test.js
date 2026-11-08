import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const ownerUrl = new URL('../../../src/index/semantic/heap/finite-versions.js', import.meta.url).href;
const budgetUrl = new URL('../../../src/index/semantic/heap/finite-budget.js', import.meta.url).href;
const consumerUrl = new URL('../../../src/semantic/heap-values.js', import.meta.url).href;
// Tighten the actual private owner in this fixture only. Production constants,
// public configuration and semantic cardinalities are unchanged.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === ownerUrl + '?tiny-budget' && specifier === './finite-budget.js') return { url: 'finite-heap:tiny-budget', shortCircuit: true };
    if (context.parentURL === consumerUrl + '?tiny-budget' && specifier === '../index/semantic/heap/finite-versions.js') return { url: ownerUrl + '?tiny-budget', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'finite-heap:tiny-budget') return { format: 'module', shortCircuit: true, source: `
      import * as owner from ${JSON.stringify(budgetUrl)};
      export * from ${JSON.stringify(budgetUrl)};
      export const FINITE_HEAP_LIMITS=Object.freeze({...owner.FINITE_HEAP_LIMITS,maxBytes:2048,
        maxValueReferences:64,maxWork:10000,maxReadCacheBytes:1024,maxReadCacheEntries:3});
      export const createFiniteHeapBudget=phase=>owner.createFiniteHeapBudget(phase,
        {...FINITE_HEAP_LIMITS,maxWork:globalThis.finiteHeapBudgetWorkLimit??FINITE_HEAP_LIMITS.maxWork});` };
    return next(url, context);
  }
});
try {
  const heap = await import(ownerUrl + '?tiny-budget');
  const { queryFiniteHeapValues } = await import(consumerUrl + '?tiny-budget');
  const input = { worldId: 'world', regionId: 'region', contextId: 'context', allocationId: 'allocation', closedProperties: true,
    properties: [{ property: 'key', values: ['seed'], presence: 'knownPresent' }] };
  const seed = heap.createFiniteHeapVersion(input), before = heap.getFiniteHeapOperationDiagnostics();
  globalThis.finiteHeapBudgetWorkLimit = 2;
  try {
    assert.throws(() => heap.createFiniteHeapVersion(input), error => error.code === 'ERR_FINITE_HEAP_BUDGET'
      && error.allowance === 'structural-work' && error.finiteHeapPhase === 'create');
    assert.equal(heap.getFiniteHeapOperationDiagnostics().payloadEncodes, before.payloadEncodes,
      'structural exhaustion rejects the raw operation before projecting and sealing a payload');
  } finally { delete globalThis.finiteHeapBudgetWorkLimit; }
  const repeated = Array.from({ length: 8 }, () => 'x'.repeat(128));
  const amplified = { ...input, properties: Array.from({ length: 16 }, (_, index) => ({ property: `p${index}`, values: repeated, presence: 'knownPresent' })) };
  const originalClone = globalThis.structuredClone; let clones = 0;
  globalThis.structuredClone = value => { clones++; return originalClone(value); };
  try {
    assert.throws(() => heap.createFiniteHeapVersion(amplified), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
    assert.equal(heap.getFiniteHeapOperationDiagnostics().payloadEncodes, before.payloadEncodes, 'oversized raw graph cannot reach property projection/sealing');
    assert.throws(() => heap.writeFiniteHeapVersion({ version: seed, property: 'key', values: Array.from({ length: 32 }, () => 'x'.repeat(128)), writeSite: 'large-write' }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
    assert.equal(clones, 0, 'aggregate write admission precedes copying the old version');
  } finally { globalThis.structuredClone = originalClone; }
  assert.deepEqual(heap.readFiniteHeapCell({ version: seed, property: 'key' }).values, ['seed']);
  assert.throws(() => heap.createFiniteHeapVersion({ ...input, properties: [{ property: 'key', values: Array(65).fill('same'), presence: 'knownPresent' }] }), error =>
    error.code === 'ERR_FINITE_HEAP_BUDGET' && error.allowance === 'value-references' && error.finiteHeapPhase === 'create');
  const largeInput = { ...input, properties: Array.from({ length: 8 }, (_, index) => ({ property: `p${index}`, values: ['v'.repeat(100)], presence: 'knownPresent' })) };
  const first = heap.createFiniteHeapVersion(largeInput), second = heap.createFiniteHeapVersion(largeInput);
  const beforeJoin = heap.getFiniteHeapOperationDiagnostics();
  assert.throws(() => heap.joinFiniteHeapVersions([first, second]), error => error.code === 'ERR_FINITE_HEAP_BUDGET' && error.allowance === 'aggregate-input-bytes');
  assert.equal(heap.getFiniteHeapOperationDiagnostics().cellVisits, beforeJoin.cellVisits, 'aggregate predecessor admission precedes branch expansion');

  let wildcard = seed;
  for (let index = 0; index < 4; index++) wildcard = heap.writeFiniteHeapVersion({ version: wildcard, property: null,
    values: Array.from({ length: 16 }, (_, ordinal) => `w${index}-${ordinal}`), writeSite: `w${index}` });
  assert.throws(() => queryFiniteHeapValues({ version: wildcard, property: null, limit: 1 }), error =>
    error.code === 'ERR_FINITE_HEAP_BUDGET' && error.allowance === 'value-references', 'a tiny presentation page cannot hide an over-budget whole union or turn it into a negative proof');
  for (let index = 0; index < 10; index++) queryFiniteHeapValues({ version: seed, property: `missing-${index}`, limit: 1 });
  const stats = heap.getFiniteHeapOperationDiagnostics(); assert.ok(stats.readCacheEntries <= 3); assert.ok(stats.readCacheBytes <= 1024);
  let getters = 0;
  const bad = { ...input }; Object.defineProperty(bad, 'properties', { enumerable: true, get() { getters++; return input.properties; } });
  assert.throws(() => heap.createFiniteHeapVersion(bad), /accessors/u); assert.equal(getters, 0);
  const sparse = [seed, seed]; delete sparse[0];
  assert.throws(() => heap.joinFiniteHeapVersions(sparse), /passive dense/u);
} finally { hooks.deregister(); }
console.log('Finite heap aggregate input/candidate/work budgets precede clone and expansion; limited pages never suppress explicit resource failure.');
