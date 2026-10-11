import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { wasmModule } from '../../helpers/wasm-fixture.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-wasm-byte-aliases-'));
const bytes = wasmModule({ functions: [{ code: [0x20, 0] }], exports: [{ name: 'run', index: 0 }] });
const inline = `new Uint8Array([${[...bytes].join(',')}])`;
try {
  const fixture = await createCompilerBoundaryFixture(root, {
    'shared-buffer.ts': `export {}; const raw = await new Response(${inline}).arrayBuffer();
      const view = new Uint8Array(raw); view[0] = 1;
      new WebAssembly.Instance(new WebAssembly.Module(raw)).exports.run(1);`,
    'escaped-buffer.ts': `export {}; declare function escape(value: Uint8Array): void;
      const raw = await new Response(${inline}).arrayBuffer(); const view = new Uint8Array(raw); escape(view);
      new WebAssembly.Instance(new WebAssembly.Module(raw)).exports.run(1);`,
    'safe-buffer.ts': `export {}; const raw = await new Response(${inline}).arrayBuffer();
      new WebAssembly.Instance(new WebAssembly.Module(raw)).exports.run(1);`,
    'safe-view.ts': `export {}; const raw = await new Response(${inline}).arrayBuffer(); const view = new Uint8Array(raw);
      new WebAssembly.Instance(new WebAssembly.Module(view)).exports.run(1);`,
    'copy.ts': `export {}; const raw = ${inline}; const copy = new Uint8Array(raw); copy[0] = 1;
      new WebAssembly.Instance(new WebAssembly.Module(raw)).exports.run(1);`,
    'retained.ts': `export {}; const raw = await (await fetch(new URL('./module.wasm', import.meta.url))).arrayBuffer();
      const view = new Uint8Array(raw); view[0] = 1;
      new WebAssembly.Instance(new WebAssembly.Module(raw)).exports.run(1);`
  }, { 'module.wasm': bytes });
  const partitions = await collectCompilerBoundaryFlow(fixture);
  const store = fixture.storeFor(partitions);
  const decoded = new Set(), reasons = [];
  for (const partition of partitions) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) {
      if (row.data.astKind === 'WasmInstruction') decoded.add(partition.sourceUnitId);
    }
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) reasons.push(row.reason || '');
  }
  for (const doc of fixture.documents) {
    assert.equal(decoded.has(doc.item.source.sourceUnitId), ['safe-buffer.ts', 'safe-view.ts', 'copy.ts'].includes(doc.item.file), doc.item.file);
  }
  assert.ok(reasons.some(reason => reason.includes('wasm_byte_source_mutation_or_escape')));
  console.log('WASM ArrayBuffer shared views reject mutation and escape while typed-array copies remain independent');
} finally { await fs.rm(root, { recursive: true, force: true }); }
