import assert from 'node:assert/strict';
import { buildPrefixedPieceStats, missingRequiredStatsFamilies } from '../../../tools/index/stats-artifacts.js';

const pieces = [
  { name: 'chunk_meta', path: 'chunk_meta.part-00001.jsonl', count: 3, bytes: 10 },
  { name: 'chunk_meta', path: 'chunk_meta.part-00002.jsonl', count: 7, bytes: 20 },
  { name: 'chunk_meta_offsets', count: 10, bytes: 4 }, { name: 'chunk_meta_meta', count: 10, bytes: 5 },
  { name: 'token_postings', path: 'token_postings.part-00001.json', count: 2, bytes: 4 },
  { name: 'token_postings', path: 'token_postings.part-00002.json', count: 5, bytes: 5 },
  { name: 'index_state' }, { name: 'filelists' }
];
assert.deepEqual(buildPrefixedPieceStats(pieces, 'chunk_meta'), { rows: 10, parts: 2, bytes: 39 });
assert.equal(buildPrefixedPieceStats(pieces, 'token_postings').rows, 7);
assert.deepEqual(missingRequiredStatsFamilies(pieces, 'default'), []);
assert.deepEqual(missingRequiredStatsFamilies(pieces.filter(row => row.name !== 'token_postings').concat({ name: 'dense_vectors' }), 'vector_only'), []);
assert.ok(missingRequiredStatsFamilies(pieces.filter(row => row.name !== 'chunk_meta'), 'default').includes('chunk_meta'));
assert.ok(missingRequiredStatsFamilies(pieces.filter(row => row.name !== 'token_postings').concat({ name: 'token_postings_meta' }), 'default').includes('token_postings'));
console.log('Stats count payload shards and enforce profile-specific payload families.');
