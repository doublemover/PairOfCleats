#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { validateArtifact } from '../../../src/shared/artifact-schemas.js';

applyTestEnv();

const validManifest = {
  version: 1,
  updatedAt: '2026-02-12T00:00:00.000Z',
  snapshots: {
    'snap-20260212-abc123': {
      snapshotId: 'snap-20260212-abc123',
      createdAt: '2026-02-12T00:00:00.000Z',
      kind: 'pointer',
      tags: ['release/v1.0.0'],
      label: 'release snapshot',
      hasFrozen: false
    }
  },
  tags: {
    'release/v1.0.0': ['snap-20260212-abc123']
  }
};

const manifestResult = validateArtifact('snapshots_manifest', validManifest);
assert.ok(manifestResult.ok, `snapshots_manifest should validate: ${manifestResult.errors?.join('; ')}`);

const invalidManifest = {
  ...validManifest,
  snapshots: {
    bad: {
      snapshotId: 'bad',
      createdAt: '2026-02-12T00:00:00.000Z',
      kind: 'pointer',
      tags: [],
      hasFrozen: false
    }
  }
};
const invalidManifestResult = validateArtifact('snapshots_manifest', invalidManifest);
assert.ok(!invalidManifestResult.ok, 'snapshots_manifest should reject invalid snapshot ids');

const validSnapshotRecord = {
  version: 1,
  snapshotId: 'snap-20260212-abc123',
  createdAt: '2026-02-12T00:00:00.000Z',
  kind: 'pointer',
  label: 'release snapshot',
  notes: 'created by test',
  tags: ['release/v1.0.0'],
  pointer: {
    buildRootsByMode: {
      code: 'builds/build-a',
      prose: 'builds/build-b'
    },
    buildIdByMode: {
      code: 'build-a',
      prose: 'build-b'
    }
  },
  provenance: {
    repoId: 'repo-123',
    repoRootHash: 'deadbeef',
    git: {
      branch: 'main',
      commit: 'abcdef123',
      dirty: false
    },
    toolVersionByMode: { code: '1.0.0', prose: '1.0.0' },
    configHashByMode: { code: 'cfg-a', prose: 'cfg-b' }
  }
};

const recordResult = validateArtifact('snapshot_record', validSnapshotRecord);
assert.ok(recordResult.ok, `snapshot_record should validate: ${recordResult.errors?.join('; ')}`);

const invalidSnapshotRecord = {
  ...validSnapshotRecord,
  pointer: {
    buildRootsByMode: {
      code: 'builds/build-a'
    }
  }
};
const invalidRecordResult = validateArtifact('snapshot_record', invalidSnapshotRecord);
assert.ok(!invalidRecordResult.ok, 'snapshot_record should require pointer.buildIdByMode');

const validFrozen = {
  version: 1,
  snapshotId: 'snap-20260212-abc123',
  frozenAt: '2026-02-12T00:05:00.000Z',
  method: 'hardlink',
  frozenRoot: 'snapshots/snap-20260212-abc123/frozen',
  included: {
    modes: ['code', 'prose'],
    sqlite: true,
    lmdb: false
  },
  verification: {
    checkedAt: '2026-02-12T00:05:10.000Z',
    ok: true,
    filesChecked: 42,
    bytesChecked: 4096,
    failures: []
  }
};
const frozenResult = validateArtifact('snapshot_frozen', validFrozen);
assert.ok(frozenResult.ok, `snapshot_frozen should validate: ${frozenResult.errors?.join('; ')}`);

console.log('snapshot contracts test passed');

