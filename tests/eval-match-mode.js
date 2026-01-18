#!/usr/bin/env node
import assert from 'node:assert/strict';
import { matchExpected, resolveMatchMode } from '../tools/eval/match.js';

assert.equal(resolveMatchMode(undefined), 'substring');
assert.equal(resolveMatchMode('exact'), 'exact');
assert.throws(() => resolveMatchMode('Exact'), /Invalid match mode/);

const hit = { file: 'src/demo.js', name: 'FooBar', kind: 'Function' };
assert.equal(matchExpected(hit, { name: 'foo' }, 'substring'), true);
assert.equal(matchExpected(hit, { name: 'foo' }, 'exact'), false);
assert.equal(matchExpected(hit, { name: 'foobar' }, 'exact'), true);
assert.equal(matchExpected(hit, { name: 'foobar', file: 'src/demo.js' }, 'exact'), true);
assert.equal(matchExpected(hit, { name: 'foobar', file: 'src/other.js' }, 'exact'), false);

console.log('eval match-mode tests passed');
