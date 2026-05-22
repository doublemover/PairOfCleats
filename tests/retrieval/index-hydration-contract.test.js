#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildFileMetaById,
  hydrateChunksFromFileMeta,
  hydrateSearchIndexPostProcessing,
  requireFileMetaForFileIdChunks
} from '../../src/retrieval/index-hydration.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();

const fileMetaById = buildFileMetaById([
  null,
  { id: null, file: 'ignored.js' },
  {
    id: 7,
    file: 'src/example.js',
    ext: 'js',
    externalDocs: ['docs/example.md'],
    last_modified: 123,
    last_author: 'Ada',
    churn: 11,
    churn_added: 12,
    churn_deleted: 13,
    churn_commits: 14
  }
]);

assert.equal(buildFileMetaById(null), null);
assert.equal(fileMetaById.size, 1);

assert.throws(
  () => requireFileMetaForFileIdChunks([{ fileId: 7 }]),
  /file_meta\.json is required/
);
assert.doesNotThrow(() => requireFileMetaForFileIdChunks([{ fileId: 7, file: 'src/example.js' }]));

{
  const chunks = [{
    fileId: 7,
    file: '',
    ext: '',
    churn: 0,
    churn_added: 0,
    churn_deleted: 0,
    churn_commits: 0
  }];
  hydrateChunksFromFileMeta(chunks, fileMetaById, { churnAssignment: 'falsy-or-nullish' });
  assert.deepEqual(chunks[0], {
    fileId: 7,
    file: 'src/example.js',
    ext: 'js',
    externalDocs: ['docs/example.md'],
    last_modified: 123,
    last_author: 'Ada',
    churn: 11,
    churn_added: 12,
    churn_deleted: 13,
    churn_commits: 14
  });
}

{
  const chunks = [{
    fileId: 7,
    file: '',
    ext: '',
    churn: 0,
    churn_added: null,
    churn_deleted: undefined,
    churn_commits: 0
  }];
  hydrateChunksFromFileMeta(chunks, fileMetaById, { churnAssignment: 'nullish' });
  assert.equal(chunks[0].churn, 0);
  assert.equal(chunks[0].churn_added, 12);
  assert.equal(chunks[0].churn_deleted, 13);
  assert.equal(chunks[0].churn_commits, 0);
}

{
  const chunks = [{
    fileId: 7,
    file: 'already.js',
    ext: 'js',
    churn: null
  }];
  hydrateChunksFromFileMeta(chunks, fileMetaById, {
    churnAssignment: 'nullish',
    skipWhenFileAndExt: true
  });
  assert.deepEqual(chunks[0], {
    fileId: 7,
    file: 'already.js',
    ext: 'js',
    churn: null
  });
}

{
  const idx = {
    phraseNgrams: { vocab: ['alpha'] },
    chargrams: { vocab: ['beta'] },
    fieldPostings: {
      fields: {
        file: { vocab: ['src/example.js'] }
      }
    }
  };
  hydrateSearchIndexPostProcessing(idx, { includeFilterIndex: false });
  assert.deepEqual([...idx.phraseNgrams.vocabIndex], [['alpha', 0]]);
  assert.deepEqual([...idx.chargrams.vocabIndex], [['beta', 0]]);
  assert.deepEqual([...idx.fieldPostings.fields.file.vocabIndex], [['src/example.js', 0]]);
  assert.equal(idx.filterIndex, null);
}

console.log('retrieval index hydration contract test passed');
