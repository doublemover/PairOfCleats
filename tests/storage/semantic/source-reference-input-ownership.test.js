import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeIdentityPath } from '../../../src/workspace/identity.js';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';

// UNVALIDATED. Actual retained source-header readers; no worktree/source fallback.
const f = await createRecoveryFixture('first source');
const originalOpen = fs.open;
try {
  const syntax = await f.write();
  const otherBytes = Buffer.from('other source');
  const otherSource = createSemanticSourceSnapshot({ bytes: otherBytes,
    repositoryNamespace: f.root, path: 'other.ts', language: 'typescript' }).manifest;
  const otherId = createSyntaxPartitionId({ sourceUnitId: otherSource.sourceUnitId,
    parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' },
    structuralPolicy: { structure: 'complete' } });
  const other = await f.write([semanticNode(0, otherSource.textLength)],
    { source: otherSource, sourceBytes: otherBytes, partitionId: otherId });
  const store = f.store([syntax, other]);
  const ref = () => ({ partitionId: f.partitionId, localId: 0 });
  const target = normalizeIdentityPath(path.join(f.stagingRoot, syntax.members.semantic_sources[0].path));
  for (const changeSpan of [false, true]) {
    const record = { ref: ref(), span: [0, f.source.textLength] }, submittedRef = record.ref;
    const handles = []; let mutations = 0;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen.call(fs, file, ...args); handles.push(handle);
      if (normalizeIdentityPath(String(file)) === target) {
        const read = handle.read;
        handle.read = function (...readArgs) {
          assert.equal(this, handle);
          if (!mutations++) {
            record.ref.partitionId = otherId; record.ref.localId = 9;
            record.ref = { partitionId: otherId, localId: 0 };
            if (changeSpan) { record.span[1] = Number.MAX_SAFE_INTEGER; record.span = [-1, -1]; }
          }
          return read.apply(handle, readArgs);
        };
      }
      return handle;
    };
    const source = await store.getSourceReference(record);
    fs.open = originalOpen;
    assert.ok(mutations > 0); assert.ok(handles.every(handle => handle.fd === -1));
    assert.deepEqual(source.ref, ref()); assert.notEqual(source.ref, submittedRef);
    assert.ok(Object.isFrozen(source.ref));
    assert.equal(source.sourceUnitId, f.source.sourceUnitId);
    assert.equal(source.sourceHash, f.source.byteHash); assert.equal(source.path, 'original.js');
    assert.equal(source.coordinateUnit, 'utf16');
  }
  const otherRef = { partitionId: otherId, localId: 0 };
  assert.equal((await store.getSourceReference({ ref: otherRef, span: [0, otherSource.textLength] })).path, 'other.ts');
  assert.equal(await store.getSourceReference({ ref: ref(), span: null }), null);
  assert.equal(await store.getSourceReference({ ref: ref(), span: undefined }), null);
  assert.equal(await store.getSourceReference({ ref: ref() }), null);
  assert.equal((await store.getSourceReference({ ref: ref(), span: [0, 0] })).path, 'original.js');

  let getters = 0, opens = 0;
  fs.open = async (...args) => { opens++; return originalOpen.apply(fs, args); };
  const accessorSpan = Object.defineProperty([], '0', { get() { getters++; return 0; } });
  accessorSpan[1] = f.source.textLength;
  const accessorRecord = Object.defineProperty({ ref: ref() }, 'span', { get() { getters++; return [0, 1]; } });
  const accessorRef = Object.defineProperty({ span: [0, 1] }, 'ref', { get() { getters++; return ref(); } });
  for (const invalid of [accessorRecord, accessorRef,
    ...[[0], [0, 1, 2], new Array(2), accessorSpan, [-1, 1], [1, 0], [0, Infinity], [0, 1.5]].map(span => ({ ref: ref(), span }))]) {
    await assert.rejects(store.getSourceReference(invalid), { code: 'ERR_SEMANTIC_INTEGRITY' });
  }
  assert.equal(getters, 0); assert.equal(opens, 0);
  const pending = Object.freeze(Object.assign(new Error('source record reflection owns pending work'), {
    cacheOwnershipReleased: () => false
  }));
  for (const failure of [undefined, null, false, 0, '', pending]) {
    const record = new Proxy({ ref: ref(), span: [0, 1] }, { getOwnPropertyDescriptor() { throw failure; } });
    await assert.rejects(store.getSourceReference(record), error => error === failure);
  }
  assert.equal(opens, 0); fs.open = originalOpen;
  await assert.rejects(store.getSourceReference({ ref: ref(), span: [0, f.source.textLength + 1] }),
    { code: 'ERR_SEMANTIC_INTEGRITY' });
  console.log('Source references retain submitted partition and span across header I/O');
} finally { fs.open = originalOpen; await f.cleanup(); }
