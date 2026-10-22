import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { readRetainedSemanticSourceSnapshot } from '../../../src/semantic/retained-source-snapshot.js';
import { materializeRetainedSemanticTaskLens } from '../../../src/context-pack/task-evidence/lens.js';

// Authored only: canonical writer/store -> one retained capture -> actual lens.
const f = await createRecoveryFixture('\uFEFFconst face = "😀";\r\nface;');
try {
  const partition = await f.write([semanticNode(0, f.source.textLength)]);
  const store = f.store([partition]), ref = { partitionId: partition.partitionId, localId: 0 };
  const captured = await readRetainedSemanticSourceSnapshot({ store, partitionId: partition.partitionId });
  assert.deepEqual(captured.bytes, f.bytes);
  assert.equal(captured.text, f.bytes.toString());
  assert.deepEqual(captured.source, f.source, 'BOM, CRLF, astral boundaries and complete canonical metadata survive');
  const worldRef = { generation: f.generation, repositoryNamespace: f.root, contextKey: 'source-only' };
  const args = { store, worldRef, taskId: 'retained-review', candidates: [{ id: 'source', ref,
    score: 1, roles: ['implementation'], mandatory: true }],
  retainedResult: { ownerHandle: 'pinned-semantic-fixture', enumeration: 'partial' } };
  await fs.writeFile(f.original, 'a changed working tree must not replace retained source');
  const lens = await materializeRetainedSemanticTaskLens(args);
  assert.equal(lens.facets[0].text, f.bytes.toString());
  assert.equal(lens.facets[0].qualification.certainty, 'exact-retained-source');
  assert.equal(lens.facets[0].editAuthority, 'not-granted');
  assert.equal(lens.renderedBytes, Buffer.byteLength(JSON.stringify(lens) + '\n'));
  const forged = { ...store, async *iterateRows(partitionId, member, options) {
    for await (const row of store.iterateRows(partitionId, member, options)) {
      yield member === 'semantic_sources' ? { ...row, lineStarts: [0, 1] } : row;
    }
  } };
  await assert.rejects(readRetainedSemanticSourceSnapshot({ store: forged, partitionId: partition.partitionId }),
    { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  await assert.rejects(materializeRetainedSemanticTaskLens({ ...args,
    worldRef: { ...worldRef, generation: { ...f.generation, baseBuildId: 'another-generation' } } }), /generation-pinned/);
  await assert.rejects(materializeRetainedSemanticTaskLens({ ...args,
    worldRef: { ...worldRef, repositoryNamespace: 'another-repository' } }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  await assert.rejects(readRetainedSemanticSourceSnapshot({ store, partitionId: partition.partitionId, maxBytes: 1 }),
    { code: 'ERR_FILE_TOO_LARGE' });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(materializeRetainedSemanticTaskLens({ ...args, signal: abort.signal }), { name: 'AbortError' });
  const retainedPath = path.join(f.stagingRoot, 'semantic-sources', f.source.byteHash + '.utf8');
  await fs.writeFile(retainedPath, Buffer.from('x'.repeat(f.bytes.length)));
  await assert.rejects(readRetainedSemanticSourceSnapshot({ store, partitionId: partition.partitionId }),
    { code: 'ERR_FILE_INTEGRITY' }, 'corrupt retained bytes never fall back to the current worktree');
} finally { await f.cleanup(); }
console.log('retained source snapshot and task-lens consumer controls passed');
