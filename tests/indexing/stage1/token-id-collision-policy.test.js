#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  appendChunk,
  createIndexState,
  enforceTokenIdCollisionPolicy
} from '../../../src/index/build/state.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createBaseIndex, defaultUserConfig } from '../validate/helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const state = createIndexState();
appendChunk(state, {
  tokens: ['alpha'],
  tokenIds: ['h64:deadbeef00000000'],
  seq: ['alpha'],
  fieldTokens: {}
});
appendChunk(state, {
  tokens: ['beta'],
  tokenIds: ['h64:deadbeef00000000'],
  seq: ['beta'],
  fieldTokens: {}
});

assert.equal(state.tokenIdCollisions.length, 1, 'expected a tokenId collision to be captured');
assert.throws(
  () => enforceTokenIdCollisionPolicy(state),
  (err) => err?.code === 'ERR_TOKEN_ID_COLLISION' && err?.count === 1,
  'stage1 policy should fail fast on tokenId collisions'
);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'token-id-collision-policy');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot } = await createBaseIndex({
  rootDir: tempRoot,
  indexState: {
    generatedAt: new Date().toISOString(),
    mode: 'code',
    stage: 'stage1',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    extensions: {
      tokenIdCollisions: {
        policy: 'fail',
        count: 1,
        sample: [
          {
            id: 'h64:deadbeef00000000',
            existing: 'alpha',
            token: 'beta'
          }
        ]
      }
    }
  }
});

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});
assert.equal(report.ok, false, 'validation should fail when tokenId collisions are recorded');
assert.ok(
  report.issues.some((issue) => issue.includes('ERR_TOKEN_ID_COLLISION')),
  'validation output should surface tokenId collision failures'
);

console.log('token id collision policy test passed');
