#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildVfsManifestSortKey } from '../../../src/index/tooling/vfs-index.js';

applyTestEnv();

const rows = [
  {
    containerPath: 'src/app.ts',
    segmentStart: 10,
    segmentEnd: 12,
    languageId: 'typescript',
    effectiveExt: '.ts',
    segmentUid: 'seg-10',
    virtualPath: 'src/app.ts#10'
  },
  {
    containerPath: 'src/app.ts',
    segmentStart: 2,
    segmentEnd: 4,
    languageId: 'typescript',
    effectiveExt: '.ts',
    segmentUid: 'seg-2',
    virtualPath: 'src/app.ts#2'
  }
];

const sortedByKey = rows
  .slice()
  .sort((a, b) => buildVfsManifestSortKey(a).localeCompare(buildVfsManifestSortKey(b)));

assert.equal(sortedByKey[0].segmentStart, 2, 'expected numeric segmentStart ordering in sort key');
assert.equal(sortedByKey[1].segmentStart, 10, 'expected numeric segmentStart ordering in sort key');

console.log('vfs sort key numeric order test passed');
