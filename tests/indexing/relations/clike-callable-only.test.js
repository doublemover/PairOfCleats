#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildCLikeChunks, buildCLikeRelations } from '../../../src/lang/clike.js';

const text = [
  'class Demo {',
  'public:',
  '  int run() {',
  '    foo();',
  '    foo();',
  '    helper.bar();',
  '    return 0;',
  '  }',
  '};'
].join('\n');

const chunks = buildCLikeChunks(text, '.hpp', { treeSitter: { enabled: false } }) || [];
assert.ok(chunks.length > 0, 'expected C-like chunks');

const relations = buildCLikeRelations(text, chunks, { ext: '.hpp' });
const callPairs = Array.isArray(relations.calls) ? relations.calls : [];

const classCalls = callPairs.filter((entry) => Array.isArray(entry) && entry[0] === 'Demo');
assert.equal(classCalls.length, 0, 'class declaration should not emit call links');

const methodFooCalls = callPairs.filter((entry) => Array.isArray(entry) && entry[0] === 'Demo.run' && entry[1] === 'foo');
assert.equal(methodFooCalls.length, 1, 'expected duplicate method call to be deduplicated');

const methodBarCalls = callPairs.filter((entry) => Array.isArray(entry) && entry[0] === 'Demo.run' && entry[1] === 'bar');
assert.equal(methodBarCalls.length, 1, 'expected method call extraction to retain callee');

console.log('clike callable-only relations test passed');
