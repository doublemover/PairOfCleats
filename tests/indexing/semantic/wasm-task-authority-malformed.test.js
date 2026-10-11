import assert from 'node:assert/strict';
import { assertWasmTaskAuthority, createWasmTaskInventory, wasmTaskInventoryHash, WASM_DEPENDENCY_KEY } from '../../../src/index/semantic/wasm/task-authority.js';
const source = { sourceUnitId: 'su1:' + 'a'.repeat(64), byteHash: 'b'.repeat(64), byteLength: 8 };
const inventory = createWasmTaskInventory([source]);
const taskFor = binaryInventory => ({ kind: 'localFlow', sourceUnits: [source.sourceUnitId], coverageToProduce: ['localFlow'],
  dependencies: [{ dependencyKey: WASM_DEPENDENCY_KEY, expectedHash: wasmTaskInventoryHash(binaryInventory) }] });
assert.doesNotThrow(() => assertWasmTaskAuthority(taskFor(inventory), { binaryInventory: inventory }));
for (const sources of [[null], [false], ['invalid'], [[]], [{ ...source, byteLength: 65537 }], [{ ...source, byteHash: null }]]) {
  const malformed = { ...inventory, sources };
  assert.throws(() => assertWasmTaskAuthority(taskFor(malformed), { binaryInventory: malformed }), { code: 'ERR_SEMANTIC_BINARY_AUTHORITY' });
}
for (const task of [null, {}, { ...taskFor(inventory), dependencies: [null] }, { ...taskFor(inventory), sourceUnits: null }]) {
  assert.throws(() => assertWasmTaskAuthority(task, { binaryInventory: inventory }), { code: 'ERR_SEMANTIC_BINARY_AUTHORITY' });
}
assert.throws(() => assertWasmTaskAuthority(taskFor(inventory), null), { code: 'ERR_SEMANTIC_BINARY_AUTHORITY' });
console.log('Malformed WASM task authority rejects invalid rows and task containers with the authority error');
