#!/usr/bin/env node
import assert from 'node:assert/strict';

import { absFromRelKey, processScmFile } from './scm-file-processor-test-helper.js';

const relKey = 'src/shared-cache-target.js';
const text = 'export const value = 1;\n';
const scmMetaCache = new Map();
let getFileMetaCalls = 0;
let annotateCalls = 0;
const scmProviderImpl = {
  async getFileMeta() {
    getFileMetaCalls += 1;
    return {
      ok: true,
      lastCommitId: 'commit-1',
      lastModifiedAt: '2026-02-20T00:00:00.000Z',
      lastAuthor: 'alice',
      churn: 1,
      churnAdded: 1,
      churnDeleted: 0,
      churnCommits: 1
    };
  },
  async annotate() {
    annotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};

await processScmFile({
  mode: 'prose',
  abs: absFromRelKey(relKey),
  ext: '.js',
  rel: relKey,
  relKey,
  text,
  fileStat: { size: Buffer.byteLength(text, 'utf8') },
  scmProviderImpl,
  scmMetaCache,
  gitBlameEnabled: false,
  analysisPolicy: { git: { churn: true, blame: false } }
});
await processScmFile({
  mode: 'extracted-prose',
  abs: absFromRelKey(relKey),
  ext: '.js',
  rel: relKey,
  relKey,
  text,
  fileStat: { size: Buffer.byteLength(text, 'utf8') },
  scmProviderImpl,
  scmMetaCache,
  gitBlameEnabled: false,
  analysisPolicy: { git: { churn: true, blame: false } }
});

assert.equal(getFileMetaCalls, 1, 'expected SCM metadata lookup reuse across prose lanes');
assert.equal(annotateCalls, 0, 'did not expect annotate calls when git blame is disabled');

console.log('shared prose-lane SCM metadata cache test passed');
