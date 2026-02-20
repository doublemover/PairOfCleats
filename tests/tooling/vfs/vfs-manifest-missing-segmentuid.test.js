#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildVfsManifestRowsForFile } from '../../../src/index/tooling/vfs.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const fileText = 'const a = 1;\nconst b = 2;\n';
const chunks = [
  {
    file: 'src/sample.js',
    lang: 'javascript',
    segment: {
      segmentId: 'seg-a',
      start: 0,
      end: 12,
      languageId: 'javascript',
      ext: '.js'
    },
    start: 0,
    end: 12
  },
  {
    file: 'src/sample.js',
    lang: 'javascript',
    segment: {
      segmentId: 'seg-b',
      start: 13,
      end: fileText.length,
      languageId: 'javascript',
      ext: '.js'
    },
    start: 13,
    end: fileText.length
  }
];

await assert.rejects(
  () => buildVfsManifestRowsForFile({
    chunks,
    fileText,
    containerPath: 'src/sample.js',
    containerExt: '.js',
    containerLanguageId: 'javascript'
  }),
  /Missing segmentUid/,
  'expected strict mode to reject segment rows without segmentUid'
);

const rows = await buildVfsManifestRowsForFile({
  chunks,
  fileText,
  containerPath: 'src/sample.js',
  containerExt: '.js',
  containerLanguageId: 'javascript',
  strict: false
});

assert.equal(rows.length, 2, 'expected non-strict mode to keep both segments');
assert.ok(
  rows.every((row) => typeof row.segmentUid === 'string' && row.segmentUid.startsWith('seg:auto:')),
  'expected non-strict mode to generate deterministic fallback segment UIDs'
);
assert.notEqual(rows[0].virtualPath, rows[1].virtualPath, 'expected unique virtual paths for fallback segment UIDs');

console.log('VFS manifest missing segmentUid guard test passed');
