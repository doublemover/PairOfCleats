import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { chunkLargeProseFallback } from '../../../src/index/chunking/dispatch/shared.js';
import { applyChunkingLimits, splitChunkByBytes } from '../../../src/index/chunking/limits.js';

const verify = (text, rows) => {
  let offset = 0;
  for (const row of rows) {
    assert.equal(row.start, offset); assert.ok(row.end > row.start);
    assert.ok(row.end <= text.length); offset = row.end;
    if (offset < text.length) assert.ok(!(text.charCodeAt(offset - 1) >= 0xd800
      && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00
      && text.charCodeAt(offset) <= 0xdfff), 'an original supplementary scalar cannot span chunks');
    if (text.isWellFormed()) assert.equal(text.slice(row.start, row.end).isWellFormed(), true);
  }
  assert.equal(offset, text.length);
  const slices = rows.map(row => text.slice(row.start, row.end));
  assert.equal(slices.join(''), text, 'source coordinates retain exact UTF-16 units');
  if (text.isWellFormed()) assert.equal(Buffer.concat(slices.map(s => Buffer.from(s))).toString('utf8'), text);
};
for (const scalar of ['😀', '𐐀']) {
  const text = 'a'.repeat(799) + scalar + 'b';
  const rows = smartChunk({ text, ext: '.unknown-scalar-fixture', mode: 'code' });
  verify(text, rows); assert.equal(rows.length, 2);
  assert.equal(rows[0].end, 799, 'default fallback repairs the original 800-unit split without a later byte cap');
}
for (const text of ['a😀b𐐀c', 'ascii only', '😀𐐀', 'a\ud800b\udc00c', '']) {
  for (const target of [1, 2, 3, 4, 800]) {
    const context = { chunking: { proseFallbackMaxChars: 1, proseFallbackChunkChars: target } };
    const rows = chunkLargeProseFallback(text, context); verify(text, rows);
    if (text) verify(text, smartChunk({ text, ext: '.txt', mode: 'prose', context }));
    assert.ok(rows.every(row => row.end - row.start <= Math.max(2, target)));
    if (target === 1 && text.startsWith('😀')) assert.equal(rows[0].end, 2,
      'a scalar wider than the character target is admitted whole and makes progress');
  }
  for (const bytes of [1, 2, 3, 4, 5]) {
    if (!text) continue;
    const original = { start: 0, end: text.length };
    const direct = splitChunkByBytes(original, text, () => [0], bytes); verify(text, direct);
    const cached = applyChunkingLimits(Array.from({ length: 5 }, () => ({ ...original })), text,
      { chunkingShared: { text }, chunking: { maxBytes: bytes, useLanguageRoleDefaults: false } });
    for (let cursor = 0, group = []; cursor < cached.length; cursor++) {
      group.push(cached[cursor]);
      if (cached[cursor].end === text.length) { verify(text, group); assert.deepEqual(group, direct); group = []; }
    }
    for (const row of direct) if (Buffer.byteLength(text.slice(row.start, row.end)) > bytes)
      assert.equal(row.meta.byteLimitOversizeScalar, true);
  }
}
console.log('actual fallback scalar boundaries and cached byte limits passed');
