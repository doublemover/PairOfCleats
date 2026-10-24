#!/usr/bin/env node
import assert from 'node:assert/strict';
import { requestCooperativeYield, maybeYield, createCooperativeYield } from '../../../src/index/build/postings/constants.js';
const idle = createCooperativeYield({ every: 1000000, minIntervalMs: 1 });
for (let index = 0; index < 10000; index += 1) assert.equal(requestCooperativeYield(idle), null);
const request = createCooperativeYield({ every: 1, minIntervalMs: 0 });
let timerRan = false; setImmediate(() => { timerRan = true; });
const pending = requestCooperativeYield(request); assert.ok(pending instanceof Promise); await pending;
assert.equal(timerRan, true);
assert.ok(maybeYield(() => null) instanceof Promise, 'legacy consumers retain Promise compatibility');
