import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { wasmModule } from '../../helpers/wasm-fixture.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-wasm-instance-aliases-'));
const bytes = `new Uint8Array([${[...wasmModule({ functions: [{ code: [0x20, 0] }], exports: [{ name: 'run', index: 0 }] })].join(',')}])`;
const instance = `new WebAssembly.Instance(new WebAssembly.Module(${bytes}))`;
try {
  const fixture = await createCompilerBoundaryFixture(root, {
    'shadow.ts': `export {}; const instance = ${instance}; const alias = instance;
      Object.defineProperty(alias, 'exports', { value: { run: (x:number) => 99 } }); instance.exports.run(1);`,
    'escape.ts': `export {}; declare function escape(value: WebAssembly.Instance): void;
      const instance = ${instance}; escape(instance); instance.exports.run(1);`,
    'wrapper.ts': `export {}; const result = await WebAssembly.instantiate(${bytes});
      Object.defineProperty(result.instance, 'exports', { value: { run: (x:number) => 99 } }); result.instance.exports.run(1);`,
    'promise-shadow.ts': `export {}; const promise = WebAssembly.instantiate(new WebAssembly.Module(${bytes}));
      const alias = promise; alias.then(instance => Object.defineProperty(instance, 'exports', { value: { run: () => 99 } }));
      const instance = await promise; instance.exports.run(1);`,
    'promise-wrapper.ts': `export {}; const promise = WebAssembly.instantiate(${bytes});
      declare const replacement: WebAssembly.Instance; promise.then(result => { result.instance = replacement; });
      const result = await promise; result.instance.exports.run(1);`,
    'await-escape.ts': `export {}; declare function escape(value: WebAssembly.Instance): void;
      const promise = WebAssembly.instantiate(new WebAssembly.Module(${bytes})); escape(await promise);
      const instance = await promise; instance.exports.run(1);`,
    'safe-promise.ts': `export {}; const promise = WebAssembly.instantiate(new WebAssembly.Module(${bytes}));
      const alias = promise; const instance = await alias; instance.exports.run(1);`,
    'safe-promise-wrapper.ts': `export {}; const promise = WebAssembly.instantiate(${bytes});
      const alias = promise; const result = await alias; result.instance.exports.run(1);`,
    'safe.ts': `export {}; const instance = ${instance}; const alias = instance; alias.exports.run(1);`
  });
  const partitions = await collectCompilerBoundaryFlow(fixture), store = fixture.storeFor(partitions);
  const joined = new Set();
  for (const partition of partitions) {
    const records = new Map();
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(row.id, row);
    for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) {
      if (edge.kind === 'callTarget' && records.get(edge.from.localId)?.data.boundaryKind === 'wasm-export-entry-request') joined.add(partition.sourceUnitId);
    }
  }
  for (const doc of fixture.documents) assert.equal(joined.has(doc.item.source.sourceUnitId), ['safe.ts', 'safe-promise.ts', 'safe-promise-wrapper.ts'].includes(doc.item.file), doc.item.file);
  console.log('WASM escaped or export-shadowed instance aliases do not authorize exact export joins');
} finally { await fs.rm(root, { recursive: true, force: true }); }
