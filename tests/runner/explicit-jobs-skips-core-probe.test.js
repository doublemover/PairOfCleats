#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTestJobs } from './run-helpers.js';
let calls = 0; const cores = () => { calls += 1; return 8; };
for (const [value, expected] of [[1, 1], [4.8, 4], [0, 1], [-1, 1]]) assert.equal(resolveTestJobs(value, cores), expected);
assert.equal(calls, 0);
assert.equal(resolveTestJobs(undefined, cores), 8); assert.equal(calls, 1);
