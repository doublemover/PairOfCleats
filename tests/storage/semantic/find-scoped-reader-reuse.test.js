import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';

const fixture = await createRecoveryFixture('fixture();\n'.repeat(32));
const originalOpen = fs.open;
try {
  const partition = await fixture.write(Array.from({ length: 32 }, (_, id) => semanticNode(id, fixture.source.textLength)));
  const base = fixture.store([partition]);
  const index = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
    partitions: [partition], store: base, diskAccount: fixture.account,
    entries: operationIndexEntries(base, [partition]), compareRows: compareOperationIndexRows,
    keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
    schemaVersion: 2, directoryPrefix: 'semantic-operation-index-', batchRows: 128, batchBytes: 262144 });
  assert.equal(index.pieces.length, 1);
  const store = fixture.store([partition], { operationIndex: index });
  const active = new Set(), opens = new Map(), bytes = new Map();
  fs.open = async (...args) => {
    const handle = await originalOpen(...args), name = path.resolve(String(args[0]));
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    opens.set(name, (opens.get(name) || 0) + 1); active.add(handle);
    handle.read = async (...readArgs) => {
      const result = await read(...readArgs);
      bytes.set(name, (bytes.get(name) || 0) + result.bytesRead);
      return result;
    };
    handle.close = async () => { try { return await close(); } finally { active.delete(handle); } };
    return handle;
  };
  const operationFile = path.resolve(fixture.stagingRoot, index.pieces[0].path);
  const request = { repoRoot: fixture.root, generation: fixture.generation,
    selector: { field: 'astKind', value: 'Identifier' }, limits: { records: 32 } };
  const find = createSemanticFindService();
  const collect = async input => {
    const ids = []; let cursor = null;
    do {
      opens.clear(); bytes.clear();
      const page = await find({ store, request: { ...input, cursor } });
      assert.equal(active.size, 0, 'all actual file handles settle before returning a page');
      assert.equal(opens.get(operationFile), 1, 'one verified operation piece owner per page');
      assert.ok(bytes.get(operationFile) <= index.pieces[0].bytes,
        'binary-search and candidate probes consume the verified snapshot');
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= (input.limits?.bytes || 65536));
      ids.push(...page.records.map(record => record.id)); cursor = page.cursor;
    } while (cursor);
    return ids;
  };
  assert.deepEqual(await collect(request), Array.from({ length: 32 }, (_, id) => id));
  assert.deepEqual(await collect({ ...request, limits: { records: 3 } }), Array.from({ length: 32 }, (_, id) => id));
  assert.deepEqual(await collect({ ...request, selector: { field: 'sourcePath', value: 'original.js',
    range: { start: fixture.source.textLength + 1, end: fixture.source.textLength + 2 } } }), []);
  assert.deepEqual(await collect({ ...request, selector: { field: 'astKind', value: 'Absent' } }), []);
  opens.clear();
  const concurrent = await Promise.all([find({ store, request }), find({ store, request })]);
  assert.equal(opens.get(operationFile), 2, 'independent concurrent requests verify independently');
  assert.equal(active.size, 0);
  for (const page of concurrent) assert.deepEqual(page.records.map(record => record.id),
    Array.from({ length: page.records.length }, (_, id) => id));

  const original = await fs.readFile(operationFile);
  const replacement = Buffer.from(original.toString('utf8').replace('Identifier', 'Xdentifier'));
  assert.equal(replacement.length, original.length);
  await fs.writeFile(operationFile, replacement);
  try {
    await assert.rejects(find({ store, request }), { code: 'ERR_SEMANTIC_INTEGRITY' });
    assert.equal(active.size, 0, 'failed fresh verification disposes every peer');
  } finally { await fs.writeFile(operationFile, original); }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(find({ store, request, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(active.size, 0);
} finally {
  fs.open = originalOpen;
  await fixture.cleanup();
}
console.log('Semantic find uses bounded request-local verified readers and fresh page integrity.');
