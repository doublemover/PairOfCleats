#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildVfsManifestRowsForFile } from '../../../src/index/tooling/vfs.js';

const fileText = 'const a = 1;\nconst b = 2;\n';
const containerPath = 'src/app.js';

const chunks = [
  {
    file: containerPath,
    ext: '.js',
    lang: 'javascript',
    segment: {
      segmentUid: 'seg-a',
      segmentId: 'seg-a',
      start: 0,
      end: 12,
      ext: '.js',
      languageId: 'javascript'
    }
  },
  {
    file: containerPath,
    ext: '.js',
    lang: 'javascript',
    segment: {
      segmentUid: 'seg-b',
      segmentId: 'seg-b',
      start: 13,
      end: fileText.length,
      ext: '.js',
      languageId: 'javascript'
    }
  }
];

const baseArgs = {
  chunks,
  fileText,
  containerPath,
  containerExt: '.js',
  containerLanguageId: 'javascript',
  strict: true
};

const serial = await buildVfsManifestRowsForFile({ ...baseArgs, concurrency: 1 });
const parallel = await buildVfsManifestRowsForFile({ ...baseArgs, concurrency: 4 });

assert.deepEqual(parallel, serial, 'expected parallel manifest rows to be deterministic');
console.log('VFS parallel manifest determinism test passed');
