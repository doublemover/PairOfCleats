#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { applyStatePatch } from '../../src/index/build/build-state/store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-state-oversized-'));
try {
  for (const target of ['state', 'progress']) {
    const buildRoot = path.join(root, target);
    await fs.mkdir(buildRoot);
    const state = JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, keep: 'original' });
    const statePath = path.join(buildRoot, 'build_state.json');
    await fs.writeFile(statePath, state);
    const filePath = target === 'state' ? statePath : path.join(buildRoot, 'build_state.progress.json');
    const bytes = JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      keep: 'x'.repeat((target === 'state' ? 8 : 4) * 1024 * 1024) });
    await fs.writeFile(filePath, bytes);
    await assert.rejects(applyStatePatch(buildRoot,
      target === 'state' ? { stage: 'new' } : { progress: { code: { done: 1 } } }),
    { code: 'ERR_BUILD_STATE_TOO_LARGE', target });
    assert.equal(await fs.readFile(filePath, 'utf8'), bytes);
    if (target === 'progress') assert.equal(await fs.readFile(statePath, 'utf8'), state);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('oversized build-state and progress patches preserve original bytes');
