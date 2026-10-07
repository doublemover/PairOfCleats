#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assembleIndexPieces } from '../../../src/index/build/piece-assembly.js';
import { createCompatibilityIndexFixture } from '../../helpers/index-compatibility-fixture.js';

applyTestEnv();

const { rootDir, indexDirs } = await createCompatibilityIndexFixture('poc-compat-assemble-', [
  {
    directory: 'index-a',
    mode: 'code',
    compatibilityKey: 'compat-a',
    includeFileLists: false,
    fileName: 'src/a.js'
  },
  {
    directory: 'index-b',
    mode: 'code',
    compatibilityKey: 'compat-b',
    includeFileLists: false,
    fileName: 'src/a.js'
  }
]);
const [inputA, inputB] = indexDirs;
const outDir = path.join(rootDir, 'out');

let failed = false;
try {
  await assembleIndexPieces({
    inputs: [inputA, inputB],
    outDir,
    root: rootDir,
    mode: 'code',
    userConfig: {},
    strict: true
  });
} catch (err) {
  failed = true;
  assert.match(
    String(err?.message || err),
    /compatibilityKey mismatch/i,
    'expected compatibilityKey mismatch error'
  );
}

if (!failed) {
  throw new Error('Expected assembleIndexPieces to reject mismatched compatibilityKey values');
}

console.log('compatibility key federation block test passed');
