#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertArtifactIdentityReconciliationReady } from '../../../src/index/build/artifacts-write/publication.js';
import { createIdentityReconciliationDriftIndex } from '../../helpers/identity-reconciliation-fixture.js';

const root = process.cwd();
const { indexDir } = await createIdentityReconciliationDriftIndex({
  root,
  cacheName: 'artifact-publication-identity-gate'
});

await assert.rejects(
  () => assertArtifactIdentityReconciliationReady({
    outDir: indexDir,
    mode: 'code'
  }),
  /\[identity\].*symbols chunkUid missing in chunk_meta/i
);

console.log('artifact publication identity gate test passed');
