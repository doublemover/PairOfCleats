#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __sanitizeHostedShellOutputForTests } from '../../../tools/ci/run-suite.js';

const titleWrapped = 'prefix\x1b]0;PairOfCleats CI\x07suffix';
assert.equal(
  __sanitizeHostedShellOutputForTests(titleWrapped),
  'prefixsuffix',
  'expected OSC title sequence to be stripped from forwarded output'
);

const stWrapped = 'left\x1b]0;PairOfCleats CI\x1b\\right';
assert.equal(
  __sanitizeHostedShellOutputForTests(stWrapped),
  'leftright',
  'expected OSC title sequence terminated by ST to be stripped from forwarded output'
);

const ansiOnly = '\x1b[36mstill-colored\x1b[0m';
assert.equal(
  __sanitizeHostedShellOutputForTests(ansiOnly),
  ansiOnly,
  'expected non-OSC ANSI sequences to remain unchanged'
);

console.log('run-suite output sanitization test passed');
