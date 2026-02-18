import assert from 'node:assert/strict';
import { createClangdStderrFilter } from '../../../../src/index/tooling/clangd-provider.js';

const filter = createClangdStderrFilter();
const logs = [];

const angledInclude = 'E[00:00:00.000] IncludeCleaner: Failed to get an entry for resolved path \'\' from include <doctest.h> : no such file or directory';
const quotedInclude = 'E[00:00:00.000] IncludeCleaner: Failed to get an entry for resolved path \'\' from include "doctest_compatibility.h" : no such file or directory';
const otherLine = 'E[00:00:00.000] Failed to parse compile flags';

assert.equal(filter.filter(angledInclude), null, 'expected angle-bracket IncludeCleaner line to be suppressed');
assert.equal(filter.filter(quotedInclude), null, 'expected quoted IncludeCleaner line to be suppressed');
assert.equal(filter.filter(otherLine), otherLine, 'expected non-IncludeCleaner stderr to pass through');

filter.flush((line) => logs.push(line));

assert.equal(logs.length, 1, 'expected one aggregate suppression summary log');
assert.ok(
  logs[0].includes('suppressed 2 IncludeCleaner stderr line(s)'),
  `expected suppression count in summary log, got: ${logs[0]}`
);

console.log('clangd stderr filter test passed');
