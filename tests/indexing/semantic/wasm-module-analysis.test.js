import assert from 'node:assert/strict';
import { decodeWasmModule, WASM_LIMITS } from '../../../src/index/semantic/wasm/decode.js';
import { analyzeWasmModule } from '../../../src/index/semantic/wasm/flow.js';
import { wasmModule, wasmHostFixture, wasmSection } from '../../helpers/wasm-fixture.js';
const decoded = bytes => {
  const result = decodeWasmModule(bytes); assert.equal(result.status, 'decoded', JSON.stringify(result)); return result.module;
};
// Breadth-first traversal without assuming node emission order.
const depends = (graph, from, to) => {
  const visited = new Set([from]), pending = [from];
  while (pending.length) {
    const current = pending.pop();
    for (const edge of graph.edges) if (['flowsTo', 'argumentToParameter', 'returnToResult'].includes(edge.kind) && edge.from === current) {
      if (edge.to === to) return true;
      if (!visited.has(edge.to)) { visited.add(edge.to); pending.push(edge.to); }
    }
  }
  return false;
};
const binary = wasmHostFixture(), module = decoded(binary);
assert.deepEqual(module.imports, [{ module: 'env', name: 'chosen', kind: 0, typeIndex: 0 }]);
assert.equal(module.functions[0].index, 1);
assert.equal(module.exports[0].index, 1);
const graph = analyzeWasmModule(module), caller = graph.functions[1], imported = graph.functions[0];
assert.ok(graph.edges.some(edge => edge.kind === 'callTarget' && edge.to === imported.ref));
assert.ok(depends(graph, caller.params[0], imported.params[0]));
assert.ok(depends(graph, imported.results[0], caller.results[0]));
assert.deepEqual(analyzeWasmModule(decoded(binary)), graph);
for (let end = 0; end < binary.length; end++) if (!WebAssembly.validate(binary.subarray(0, end))) assert.notEqual(decodeWasmModule(binary.subarray(0, end)).status, 'decoded', 'truncated byte ' + end);
assert.equal(decodeWasmModule(Buffer.from([0,97,115,109,1,0,0,0,1,128,128,128,128,16])).reason, 'wasm_leb_overflow');
assert.equal(decodeWasmModule(Buffer.concat([binary, Buffer.from(wasmSection(1, [0]))])).reason, 'wasm_section_order_or_duplicate');
assert.equal(decodeWasmModule(wasmModule({ functions: [{ code: [0xfc, 0] }] })).status, 'unsupported');
assert.equal(decodeWasmModule(wasmModule({ functions: [{ code: [0x6a] }] })).reason, 'wasm_validation_failed');
assert.equal(decodeWasmModule(wasmModule({ functions: [{ code: [0x20, 3] }] })).reason, 'wasm_validation_failed');
assert.equal(decodeWasmModule(new Uint8Array(WASM_LIMITS.bytes + 1)).reason, 'wasm_byte_budget');
// if/else joins preserve both stack and local reaching definitions.
const conditional = analyzeWasmModule(decoded(wasmModule({ types: [{ params: [0x7f, 0x7f, 0x7f], results: [0x7f] }],
  functions: [{ locals: [0x7f], code: [0x20, 0, 0x04, 0x40, 0x20, 1, 0x21, 3, 0x05, 0x20, 2, 0x21, 3, 0x0b, 0x20, 3] }] })));
assert.ok(depends(conditional, conditional.functions[0].params[1], conditional.functions[0].results[0]));
assert.ok(depends(conditional, conditional.functions[0].params[2], conditional.functions[0].results[0]));
assert.ok(conditional.edges.some(edge => edge.kind === 'controlTrue'));
assert.ok(conditional.edges.some(edge => edge.kind === 'controlFalse'));
// A loop-carried local enters a stable header merge on a backedge.
const loop = analyzeWasmModule(decoded(wasmModule({ functions: [{ code: [0x03,0x40, 0x20,0, 0x41,1, 0x6b, 0x22,0, 0x0d,0, 0x0b, 0x20,0] }] })));
assert.ok(depends(loop, loop.functions[0].params[0], loop.functions[0].results[0]));
const merges = loop.nodes.filter(node => node.kind === 'value' && node.origin === 'merge');
assert.ok(merges.some(merge => loop.edges.filter(edge => edge.kind === 'flowsTo' && edge.to === merge.id).length > 1));
// A branch carries its label result; dead fallthrough constants do not flow.
const branch = analyzeWasmModule(decoded(wasmModule({ functions: [{ code: [0x02,0x7f, 0x20,0, 0x0c,0, 0x41,9, 0x0b] }] })));
assert.ok(depends(branch, branch.functions[0].params[0], branch.functions[0].results[0]));
const dead = branch.nodes.find(node => node.kind === 'instruction' && node.name === 'i32.const');
assert.ok(!branch.edges.some(edge => edge.from === dead.id || edge.to === dead.id));
// br_table includes the fallback target and consumes its selector separately.
const table = analyzeWasmModule(decoded(wasmModule({ functions: [{ code: [0x02,0x7f, 0x20,0, 0x41,0, 0x0e,1,0,0, 0x0b] }] })));
assert.ok(depends(table, table.functions[0].params[0], table.functions[0].results[0]));
const trapped = analyzeWasmModule(decoded(wasmModule({ functions: [{ code: [0x00, 0x41,1] }] })));
assert.ok(trapped.edges.some(edge => edge.kind === 'exceptional'));
assert.ok(!trapped.edges.some(edge => edge.kind === 'flowsTo' && edge.to === trapped.functions[0].results[0]));
// Typed multi-value blocks use signed type-index immediates and ordered results.
const multi = analyzeWasmModule(decoded(wasmModule({ types: [{ params: [0x7f], results: [0x7f,0x7f] }], functions: [{ code: [0x20,0, 0x02,0, 0x20,0, 0x0b] }] })));
assert.equal(multi.functions[0].results.length, 2);
assert.ok(multi.functions[0].results.every(result => depends(multi, multi.functions[0].params[0], result)));
// Exact large integer and float bit representations never pass through Number.
const numeric = decoded(wasmModule({ types: [{ params: [], results: [0x7e] }], functions: [{ code: [0x42,0x7f] }] }));
assert.equal(numeric.functions[0].instructions[0].value, '-1');
// Indirect calls retain the table operand and signature without invented targets.
const indirect = analyzeWasmModule(decoded(wasmModule({
  functions: [{ code: [0x20,0, 0x41,0, 0x11,0,0] }],
  sections: [wasmSection(4, [1,0x70,0,1]), wasmSection(9, [1,0,0x41,0,11,1,0])]
})));
assert.ok(indirect.reasons.includes('wasm_indirect_call_table_target_unresolved'));
assert.ok(!indirect.edges.some(edge => edge.kind === 'callTarget'));
assert.ok(indirect.edges.some(edge => edge.kind === 'consumes' && edge.slot === 'callee'));
const memoryModule = decoded(wasmModule({ functions: [{ code: [0x20,0, 0x28,2,0] }],
  sections: [wasmSection(5, [1,0,1]), wasmSection(6, [1,0x7f,0,0x41,0,11]), wasmSection(11, [1,0,0x41,0,11,2,1,2])]
}));
assert.equal(memoryModule.memories[0].min, 1);
assert.equal(memoryModule.globals[0].initializer[0].value, 0);
assert.equal(memoryModule.data[0].bytes, '0102');
const memory = analyzeWasmModule(memoryModule);
assert.ok(memory.reasons.includes('wasm_memory_contents_alias_growth_and_trap_outcomes_unresolved'));
assert.ok(memory.edges.some(edge => edge.kind === 'exceptional'));
const largeGraph = decoded(wasmModule({ functions: [{ locals: Array(255).fill(0x7f), code: [...Array.from({length:140}, () => [2,0x40,11]).flat(), 0x20,0] }] }));
assert.throws(() => analyzeWasmModule(largeGraph), error => error.code === 'ERR_WASM_FLOW_BUDGET');
assert.equal(decodeWasmModule(wasmModule({ functions: [{ locals: Array(256).fill(0x7f), code: [0x20,0] }] })).reason, 'wasm_local_budget');
const controller = new AbortController(); controller.abort();
assert.throws(() => decodeWasmModule(binary, { signal: controller.signal }), error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
assert.throws(() => analyzeWasmModule(module, { signal: controller.signal }), error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
console.log('WASM binary bounds, stack joins, loop backedges and call channels passed');
