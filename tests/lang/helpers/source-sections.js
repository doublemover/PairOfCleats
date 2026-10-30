import assert from 'node:assert/strict';

/** Check complete source retention before testing declaration-only metadata. */
export const sourceSections = (text, chunks) => {
  assert.ok(chunks.length, 'the chunker retains a source envelope');
  let cursor = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.start, cursor, 'section envelopes cover the source without gaps or overlap');
    assert.ok(chunk.end >= chunk.start && chunk.end <= text.length);
    cursor = chunk.end;
  }
  assert.equal(cursor, text.length, 'the final section retains the source suffix');
  const prefix = chunks[0];
  const xmlDocumentPrefix = prefix.meta?.sourceCoverage === 'document-envelope'
    && prefix.meta.sectionRangeSource === 'application-source-gap';
  if (!prefix.meta?.preamble && prefix.meta?.sourceCoverage !== 'container-preamble' && !xmlDocumentPrefix) return chunks;
  assert.ok(prefix.end > 0 && chunks.length > 1, 'a preamble precedes an actual section');
  assert.equal(prefix.name, prefix.meta.preamble ? 'preamble' : 'root-preamble');
  assert.equal(prefix.meta.astRange, undefined, 'retained source is not a fabricated syntax node');
  assert.equal(prefix.meta.lexicalRange, undefined);
  assert.equal(prefix.meta.tokenRange, undefined);
  if (xmlDocumentPrefix) {
    assert.equal(prefix.meta.format, 'xml');
    assert.equal(prefix.meta.lexicalElementRange, undefined);
    assert.equal(prefix.meta.nameRange, undefined);
    assert.equal(prefix.meta.openingRange, undefined, 'document source coverage is not a fabricated XML opening element');
  }
  assert.equal(text.slice(0, prefix.end), text.slice(prefix.start, chunks[1].start));
  return chunks.slice(1);
};
