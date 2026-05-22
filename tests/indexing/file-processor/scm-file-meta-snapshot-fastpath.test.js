#!/usr/bin/env node
import assert from 'node:assert/strict';
import { processScmFile, readFixture } from './scm-file-processor-test-helper.js';

const fixture = await readFixture('tests', 'fixtures', 'mixed', 'src', 'config.yml');

let metaCalls = 0;
const scmProviderImpl = {
  async getFileMeta() {
    metaCalls += 1;
    return { ok: false, reason: 'unavailable' };
  },
  async annotate() {
    return { ok: false, reason: 'disabled' };
  }
};

const result = await processScmFile({
  ...fixture,
  fileHash: 'snapshot-fastpath-hash',
  scmProviderImpl,
  scmConfig: { annotate: { enabled: false } },
  scmFileMetaByPath: {
    [fixture.relKey]: {
      lastModifiedAt: '2026-01-01T00:00:00Z',
      lastAuthor: 'snapshot-author',
      churn: 11,
      churnAdded: 6,
      churnDeleted: 5,
      churnCommits: 2
    }
  },
  gitBlameEnabled: false,
  analysisPolicy: { git: { blame: false, churn: true } },
  languageHint: null,
  perfEventLogger: null
});

assert.equal(metaCalls, 0, 'expected snapshot metadata to bypass per-file SCM getFileMeta calls');
assert.ok(result?.chunks?.length >= 0, 'expected file processor result');

console.log('scm file meta snapshot fastpath test passed');
