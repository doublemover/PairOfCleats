#!/usr/bin/env node
import assert from 'node:assert';
import { cleanContext } from '../../../src/retrieval/output/context.js';

const cleaned = cleanContext([null, 42, 'ok line', { foo: 'bar' }, '```', 'another line']);
assert.deepStrictEqual(cleaned, ['ok line', 'another line']);
console.log('cleanContext non-string guard test passed');
