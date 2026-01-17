#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compareStrings } from '../../src/shared/sort.js';

const values = ['b', 'A', 'a', 'B', 'aa', ''];
const sorted = [...values].sort(compareStrings);
assert.deepEqual(sorted, ['', 'A', 'B', 'a', 'aa', 'b']);
assert.equal(compareStrings('same', 'same'), 0);

console.log('sort determinism test passed');
