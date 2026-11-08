import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';

// UNVALIDATED: real shape-valid stored nodes, retained UTF8 bytes and excerpt consumer.
const text = 'A😀𝒜Z\r\n', fixture = await createRecoveryFixture(text);
try {
  const valid = [[0, 0], [0, 1], [1, 3], [3, 5], [1, 5], [0, text.length], [text.length, text.length], [3, 3]];
  const invalid = [[1, 2], [2, 3], [2, 2], [4, 4], [3, 4], [4, 5]];
  const rows = [...valid, ...invalid].map((span, id) => {
    const entry = semanticNode(id, text.length); entry.row.span = span; return entry;
  });
  const partition = await fixture.write(rows), store = fixture.store([partition]);
  const ref = localId => ({ partitionId: partition.partitionId, localId });
  await fs.writeFile(fixture.original, 'working tree has changed');
  const excerpts = await store.getSourceSpans(valid.map((_span, id) => ref(id)));
  for (let index = 0; index < valid.length; index += 1) {
    assert.equal(excerpts[index].text, text.slice(...valid[index]));
    assert.equal(excerpts[index].sourceHash, fixture.source.byteHash);
    assert.deepEqual(excerpts[index].span, valid[index]);
    assert.equal(excerpts[index].coordinateUnit, 'utf16');
  }
  assert.equal((await store.getSourceSpans([ref(0), ref(6), ref(7)], { maxBytes: 0 })).length, 3,
    'empty excerpts at complete scalar/EOF boundaries remain valid under a zero-byte response allowance');
  assert.equal((await store.getSourceSpans([ref(2)], { maxBytes: 4 }))[0].text, '😀');
  await assert.rejects(store.getSourceSpans([ref(2)], { maxBytes: 3 }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  for (let index = 0; index < invalid.length; index += 1) {
    const selected = ref(valid.length + index);
    assert.deepEqual((await store.getRecords([selected]))[0].span, invalid[index],
      'the fixture actually persisted the invalid scalar endpoint under the unchanged wire shape');
    await assert.rejects(store.getSourceSpans([selected]), { code: 'ERR_SEMANTIC_INTEGRITY' });
    await assert.rejects(store.getSourceSpans([ref(2), selected]), { code: 'ERR_SEMANTIC_INTEGRITY' },
      'a mixed request cannot publish a partial successful excerpt array');
    await assert.rejects(store.verifySource(fixture.source, { spans: [invalid[index]] }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  }
  assert.equal((await store.getSourceSpans([ref(2), ref(3)]))[1].text, '𝒜',
    'a rejected span cannot poison a later valid retained-source request');
} finally { await fixture.cleanup(); }
console.log('Retained source excerpts reject split scalar endpoints without changing byte budgets.');
