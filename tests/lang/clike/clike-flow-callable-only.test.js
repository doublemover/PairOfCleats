#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildCLikeChunks, computeCLikeFlow } from '../../../src/lang/clike.js';

const text = [
  'class Demo {',
  'public:',
  '  int run(int value) {',
  '    if (value > 0) {',
  '      return value;',
  '    }',
  '    return 0;',
  '  }',
  '};'
].join('\n');

const chunks = buildCLikeChunks(text, '.hpp', { treeSitter: { enabled: false } }) || [];
const classChunk = chunks.find((chunk) => chunk.kind === 'ClassDeclaration');
const methodChunk = chunks.find((chunk) => chunk.kind === 'FunctionDeclaration' || chunk.kind === 'MethodDeclaration');

assert.ok(classChunk, 'expected class chunk');
assert.ok(methodChunk, 'expected callable chunk');

const classFlow = computeCLikeFlow(text, classChunk, {});
assert.equal(classFlow, null, 'non-callable declarations should skip C-like flow analysis');

const methodFlow = computeCLikeFlow(text, methodChunk, {});
assert.ok(methodFlow && typeof methodFlow === 'object', 'expected callable flow metadata');
assert.equal(methodFlow.returnsValue, true, 'expected callable flow to preserve return-value detection');

console.log('clike callable-only flow test passed');
