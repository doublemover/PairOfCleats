#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseBuildSqliteArgs, normalizeValidateMode } from '../../../../tools/build/sqlite/cli.js';

const parsed = parseBuildSqliteArgs(['--mode', 'prose', '--out', 'outdir', '--validate', 'full']);
assert.equal(parsed.modeArg, 'prose');
assert.equal(parsed.validateMode, 'full');
assert.equal(parsed.argv.out, 'outdir');

const parsedDefault = parseBuildSqliteArgs([]);
assert.equal(parsedDefault.modeArg, 'all');
assert.equal(parsedDefault.validateMode, 'smoke');

assert.equal(normalizeValidateMode(false), 'off');
assert.equal(normalizeValidateMode('auto'), 'auto');

console.log('build-sqlite-index args parsing test passed');
