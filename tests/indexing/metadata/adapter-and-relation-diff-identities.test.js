import assert from 'node:assert/strict';
import { buildChunkPrepareOptions, buildChunkRelationOptions } from '../../../src/index/language-registry/registry-data.js';
import { buildRelationSet } from '../../../src/index/diffs/chunk-diff.js';

const options = { parser: 'fallback', go: { parser: 'tree-sitter' }, relPath: 'wrong.go', dialect: 'wrong' };
const input = { options, relPath: 'right.go', parserScope: 'go' };
assert.equal(buildChunkPrepareOptions(input).parser, 'tree-sitter');
assert.equal(buildChunkRelationOptions(input).parser, 'tree-sitter');
assert.equal(buildChunkRelationOptions(input).relPath, 'right.go');
assert.equal(buildChunkRelationOptions({ ...input, extras: { dialect: 'postgres' } }).dialect, 'postgres');
const relation = target => buildRelationSet({ raw: { codeRelations: {
  imports: ['pkg'], calls: [['caller', target]], usageLinks: [{ to: { status: 'resolved', resolved: { chunkUid: target } } }]
} } });
const before = relation('u1'), after = relation('u2');
assert.equal([...before].filter(key => !after.has(key)).length, 2);
assert.equal([...after].filter(key => !before.has(key)).length, 2);
assert.deepEqual(relation('u1'), before);
console.log('adapter and relation diff identity test passed');
