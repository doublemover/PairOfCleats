#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  sanitizeBenchNodeOptions,
  stripMaxOldSpaceFlag,
  stripNodeInspectorFlags
} from '../../../tools/bench/language/node-options.js';

applyTestEnv();

assert.equal(
  stripNodeInspectorFlags('--inspect --trace-warnings --inspect-port=9321'),
  '--trace-warnings',
  'expected inspector flags to be removed'
);

assert.equal(
  stripMaxOldSpaceFlag('--trace-gc --max-old-space-size=8192 --stack-trace-limit=200'),
  '--trace-gc --stack-trace-limit=200',
  'expected max-old-space-size flag to be removed'
);

assert.equal(
  sanitizeBenchNodeOptions(
    '--inspect-brk=0.0.0.0:9229 --trace-warnings --max-old-space-size 8192 --inspect-port 9333',
    { stripHeap: true }
  ),
  '--trace-warnings',
  'expected bench sanitization to strip heap and inspector flags'
);

assert.equal(
  sanitizeBenchNodeOptions(
    '--inspect --trace-gc --max-old-space-size=4096',
    { stripHeap: false }
  ),
  '--trace-gc --max-old-space-size=4096',
  'expected bench sanitization to preserve heap flag when stripHeap=false'
);

console.log('node options sanitization test passed');
