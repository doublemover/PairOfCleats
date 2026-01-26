#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseSearchArgs } from '../../src/retrieval/cli-args.js';

const argv = parseSearchArgs(['--lang', 'ts', '--ext', '.js', '--filter', 'ext:ts', 'query']);

assert.equal(argv.lang, 'ts');
assert.equal(argv.ext, '.js');
assert.equal(argv.filter, 'ext:ts');
assert.equal(argv._[0], 'query');

console.log('retrieval cli options smoke test passed');
