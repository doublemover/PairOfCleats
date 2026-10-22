#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { REMOVED_FLAGS } from '../../../src/retrieval/cli-options.js';

for (const args of [['--human'], ['--human=true'], ['--context', '3'], ['--context=3'], ['--headline'],
  ['--human', '--context=3']]) {
  assert.throws(() => parseSearchArgs(args), error => {
    assert.equal(error.code, 'REMOVED_FLAG');
    assert.match(error.message, /search --help --all --json/);
    if (args.some(value => value.startsWith('--context'))) {
      assert.equal(error.remedies.find(value => value.flag === '--context').configPath, 'retrieval.contextExpansion');
      assert.doesNotMatch(error.message, /search\.contextExpansion/);
    }
    return true;
  });
}
assert.equal(parseSearchArgs([]).json, false, 'removing --human preserves its requested output mode');
assert.equal(parseSearchArgs(['--json']).json, true);
assert.deepEqual(parseSearchArgs(['--', '--human'])._, ['--human'], 'literal query words remain outside removed-option repair');
assert.deepEqual(REMOVED_FLAGS.map(value => value.flag), ['--human', '--headline', '--context']);
console.log('removed option remedies preserve actual current CLI/config intent');
