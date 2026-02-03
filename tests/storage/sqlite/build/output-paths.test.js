#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveOutputPaths } from '../../../../tools/build/sqlite/run.js';

const sqlitePaths = {
  codePath: path.join('C:', 'cache', 'index-code.db'),
  prosePath: path.join('C:', 'cache', 'index-prose.db'),
  extractedProsePath: path.join('C:', 'cache', 'index-extracted-prose.db'),
  recordsPath: path.join('C:', 'cache', 'index-records.db')
};

const outDir = path.join('C:', 'tmp', 'sqlite-out');
const codePaths = resolveOutputPaths({ modeArg: 'code', outArg: outDir, sqlitePaths });
assert.equal(codePaths.outPath, path.join(outDir, 'index-code.db'));

const allPaths = resolveOutputPaths({ modeArg: 'all', outArg: outDir, sqlitePaths });
assert.equal(allPaths.outPath, null);
assert.equal(allPaths.codeOutPath, path.join(outDir, 'index-code.db'));
assert.equal(allPaths.proseOutPath, path.join(outDir, 'index-prose.db'));

const fileOut = resolveOutputPaths({ modeArg: 'prose', outArg: path.join(outDir, 'custom.db'), sqlitePaths });
assert.equal(fileOut.outPath, path.join(outDir, 'custom.db'));

console.log('build-sqlite-index output paths test passed');
