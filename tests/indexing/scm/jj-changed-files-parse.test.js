#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseJjFileListOutput } from '../../../src/index/scm/providers/jj-parse.js';

const nulOutput = 'src/a.js\0src/b.js\0';
const nulParsed = parseJjFileListOutput({ output: nulOutput, nullDelimited: true });
assert.deepEqual(nulParsed, ['src/a.js', 'src/b.js']);

const lineOutput = 'src/c.js\nsrc/d.js\n';
const lineParsed = parseJjFileListOutput({ output: lineOutput, nullDelimited: false });
assert.deepEqual(lineParsed, ['src/c.js', 'src/d.js']);

console.log('jj changed-files parse ok');
