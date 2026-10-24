#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getSearchHelp, getSearchUsage, SEARCH_OPTION_NAMES } from '../../../src/retrieval/cli-args.js';
import { printHelp } from '../../../src/retrieval/cli/search-entry.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const usage = getSearchUsage();
assert.match(usage, /Readable results are the default/);
assert.match(usage, /--top N \(default: 5 per mode/);
assert.match(usage, /--compact \(smaller hit projection with --json\)/);
assert.doesNotMatch(usage, /--json \(compact JSON/);
const full = getSearchHelp({ full: true });
assert.deepEqual(Object.keys(full.options), SEARCH_OPTION_NAMES);
assert.equal(full.options.top.default, 5);
assert.equal(full.options.json.default, false);
assert.equal(full.options.plain.default, false);
assert.ok(full.examples.some((example) => example.includes('search "parseSearchArgs"') && !example.includes('--json')));
assert.match(full.semantics.output, /current files at indexed offsets/);
assert.match(full.semantics.output, /not ranking evidence/);
for (const all of [false, true]) {
  const chunks = [];
  await withTemporaryEnv({ NO_COLOR: '', TERM: 'xterm', COLUMNS: '32' }, () => {
    printHelp({ columns: 32, isTTY: true, write: (value) => chunks.push(String(value)) }, { full: all });
  });
  const text = chunks.join('');
  assert.doesNotMatch(text, /\x1b/);
  assert.ok(text.split('\n').every((line) => line.length <= 32));
  assert.match(text, /--top/);
}
const json = [];
printHelp({ columns: 20, isTTY: true, write: (value) => json.push(String(value)) }, { full: true, json: true });
assert.deepEqual(JSON.parse(json.join('')), full, 'machine help must not be wrapped or styled');
console.log('readable search help test passed');
