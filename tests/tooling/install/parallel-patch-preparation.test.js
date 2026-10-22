#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyPatches, applyPatchesAsync } from '../../../tools/setup/apply-patches.js';
import { createPatchFixture, originalText, patchedText } from './patch-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parallel-patch-'));
try {
  const fixtures = await Promise.all(['aaa', 'bbb', 'ccc'].map(packageName =>
    createPatchFixture(root, { packageName })));
  await fs.writeFile(fixtures[2].target, 'incompatible source\n');
  await assert.rejects(applyPatchesAsync(root), /not fully applied/);
  assert.equal(await fs.readFile(fixtures[0].target, 'utf8'), originalText, 'no prepared target publishes on peer failure');
  assert.equal(await fs.readFile(fixtures[1].target, 'utf8'), originalText);
  await fs.writeFile(fixtures[2].target, originalText);
  assert.equal(await applyPatchesAsync(root), 3);
  for (const fixture of fixtures) assert.equal(await fs.readFile(fixture.target, 'utf8'), patchedText);
  assert.equal(await applyPatchesAsync(root, { verifyOnly: true }), 3);
  assert.equal(applyPatches(root, { verifyOnly: true }), 3, 'synchronous consumers retain the same state machine');
  await fs.writeFile(fixtures[1].target, originalText);
  await assert.rejects(applyPatchesAsync(root, { verifyOnly: true }), /has not been applied/);
  assert.equal(await fs.readFile(fixtures[1].target, 'utf8'), originalText);
  const controller = new AbortController(); controller.abort(new Error('cancelled patch preparation'));
  await assert.rejects(applyPatchesAsync(root, { signal: controller.signal }), /cancelled/);
  assert.equal(await fs.readFile(fixtures[1].target, 'utf8'), originalText);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('parallel patch preparation test passed');
