import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';

// UNVALIDATED: real retained partitions, physical indexes and descriptor reads.
const f = await createRecoveryFixture('alpha one');
const originalOpen = fs.open;
try {
  const ref = localId => ({ partitionId: f.partitionId, localId });
  const syntax = await f.write([semanticNode(0, f.source.textLength), semanticNode(1, f.source.textLength),
    { family: 'operand', row: { parent: ref(0), child: ref(1), slot: 'callee', ordinal: 0, flags: [] } }]);
  const otherBytes = Buffer.from('bravo two');
  const otherSource = createSemanticSourceSnapshot({ bytes: otherBytes,
    repositoryNamespace: f.root, path: 'other.js', language: 'javascript' }).manifest;
  const otherId = createSyntaxPartitionId({ sourceUnitId: otherSource.sourceUnitId,
    parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' },
    structuralPolicy: { structure: 'complete' } });
  const other = await f.write([semanticNode(0, otherSource.textLength)],
    { source: otherSource, sourceBytes: otherBytes, partitionId: otherId });
  const partitions = [syntax, other], base = f.store(partitions);
  const queryIndex = await writeSemanticQueryIndex({ root: f.stagingRoot, generation: f.generation,
    partitions, store: base, diskAccount: f.account });
  const store = f.store(partitions, { queryIndex });
  const duringRead = async (relative, run, mutate) => {
    const target = path.resolve(f.stagingRoot, relative);
    let changes = 0;
    const handles = [];
    fs.open = async (file, ...args) => {
      const handle = await originalOpen.call(fs, file, ...args);
      handles.push(handle);
      if (path.resolve(String(file)) === target) {
        const nativeRead = handle.read;
        handle.read = function (...readArgs) {
          assert.equal(this, handle);
          if (!changes++) mutate();
          return nativeRead.apply(handle, readArgs);
        };
      }
      return handle;
    };
    try {
      const result = await run();
      assert.ok(changes > 0, 'mutation occurs inside an actual retained-piece read');
      return result;
    } finally {
      fs.open = originalOpen;
      assert.ok(handles.every(handle => handle.fd === -1), 'all original descriptors settle');
    }
  };
  const input = ref(0), refs = [input], fields = ['span'];
  const records = await duringRead(syntax.members.semantic_records[0].path,
    () => store.getRecords(refs, fields), () => {
      input.partitionId = otherId; input.localId = 1; refs[0] = { partitionId: otherId, localId: 0 };
      fields[0] = 'data'; fields.push('kind');
    });
  assert.deepEqual(records[0].ref, ref(0));
  assert.notEqual(records[0].ref, input);
  assert.ok(Object.isFrozen(records[0].ref));
  assert.deepEqual(records[0].span, [0, f.source.textLength]);
  assert.equal(Object.hasOwn(records[0], 'data'), false);
  assert.deepEqual(records[0].omittedFieldGroups, ['scope', 'data']);
  assert.equal(records[0].kind, 'expression');

  const sourceRef = ref(0), sourceRefs = [sourceRef];
  const excerpts = await duringRead(syntax.members.semantic_records[0].path,
    () => store.getSourceSpans(sourceRefs), () => {
      sourceRef.partitionId = otherId; sourceRefs[0] = { partitionId: otherId, localId: 0 };
    });
  assert.deepEqual(excerpts[0].ref, ref(0));
  assert.equal(excerpts[0].sourceUnitId, f.source.sourceUnitId);
  assert.equal(excerpts[0].sourceHash, f.source.byteHash);
  assert.equal(excerpts[0].text, 'alpha one');
  assert.equal((await store.getSourceSpans([{ partitionId: otherId, localId: 0 }]))[0].text, 'bravo two');

  const relatedRef = ref(0);
  const related = await duringRead(queryIndex.pieces[0].path,
    () => store.getRelatedPage(relatedRef, 'semantic_operands'), () => { relatedRef.partitionId = otherId; });
  assert.equal(related.rows.length, 1);
  assert.deepEqual(related.rows[0].parent, ref(0));
  assert.equal(related.done, true);
  assert.equal((await store.getRelatedPage({ partitionId: otherId, localId: 0 }, 'semantic_operands')).rows.length, 0);

  const duplicates = await store.getRecords([ref(0)], Array(4096).fill('span'));
  assert.deepEqual(duplicates[0].span, records[0].span);
  assert.deepEqual(duplicates[0].omittedFieldGroups, ['scope', 'data']);
  assert.equal(Object.hasOwn((await store.getRecords([ref(0)], []))[0], 'span'), false);
  let getters = 0;
  const accessorRef = Object.defineProperty({ localId: 0 }, 'partitionId', {
    enumerable: true, get() { getters++; return f.partitionId; }
  });
  const accessorFields = Object.defineProperty([], '0', { get() { getters++; return 'data'; } });
  const accessorRefs = Object.defineProperty([], '0', { get() { getters++; return ref(0); } });
  for (const invalid of [accessorRef, { ...ref(0), extra: true }, { ...ref(0), localId: -1 }]) {
    await assert.rejects(store.getRecords([invalid]), { code: 'ERR_SEMANTIC_INTEGRITY' });
  }
  for (const invalid of [accessorRefs, new Array(1), Array(129).fill(ref(0))]) {
    await assert.rejects(store.getRecords(invalid), { code: 'ERR_SEMANTIC_INTEGRITY' });
  }
  for (const invalid of [accessorFields, new Array(1), ['unknown']]) {
    await assert.rejects(store.getRecords([ref(0)], invalid), { code: 'ERR_SEMANTIC_INTEGRITY' });
  }
  assert.equal(getters, 0);
  let settled = false;
  const pending = Object.freeze(Object.assign(new Error('caller reflection owns pending work'), {
    cacheOwnershipReleased: () => settled
  }));
  const reflected = new Proxy(ref(0), { getOwnPropertyDescriptor() { throw pending; } });
  await assert.rejects(store.getRecords([reflected]), error => error === pending);
  await assert.rejects(store.getSourceSpans([reflected]), error => error === pending);
  await assert.rejects(store.getRelatedPage(reflected, 'semantic_operands'), error => error === pending);
  assert.equal(pending.cacheOwnershipReleased(), false); settled = true;
  assert.equal(pending.cacheOwnershipReleased(), true);
  console.log('Direct artifact readers own submitted refs and fields across physical reads');
} finally {
  fs.open = originalOpen;
  await f.cleanup();
}
