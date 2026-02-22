#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateArtifact } from '../../../src/shared/artifact-schemas.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const base = {
  buildId: 'build-123',
  buildRoot: 'builds/build-123',
  promotedAt: '2026-02-22T00:00:00.000Z',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  repo: {
    provider: 'jj',
    root: '/tmp/repo',
    head: {
      commitId: 'abcdef123456',
      changeId: '123456abcdef',
      operationId: 'op-123',
      branch: null,
      bookmarks: ['main'],
      author: 'test',
      timestamp: '2026-02-22T00:00:00Z'
    },
    dirty: false,
    detectedBy: 'jj-root',
    isRepo: true,
    commit: 'abcdef123456',
    branch: null,
    bookmarks: ['main']
  }
};

const withOperationId = validateArtifact('builds_current', base);
assert.ok(withOperationId.ok, `builds_current should accept repo.head.operationId: ${withOperationId.errors?.join('; ')}`);

const withoutOperationId = validateArtifact('builds_current', {
  ...base,
  repo: {
    ...base.repo,
    head: {
      ...base.repo.head,
      operationId: null
    }
  }
});
assert.ok(withoutOperationId.ok, `builds_current should accept null repo.head.operationId: ${withoutOperationId.errors?.join('; ')}`);

const withUnknownHeadField = validateArtifact('builds_current', {
  ...base,
  repo: {
    ...base.repo,
    head: {
      ...base.repo.head,
      unexpected: true
    }
  }
});
assert.ok(!withUnknownHeadField.ok, 'builds_current should reject unknown repo.head fields');

console.log('builds_current repo.head schema test passed');
