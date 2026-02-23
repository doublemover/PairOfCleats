#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { updateEnrichmentState } from '../../../src/integrations/core/enrichment-state.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'enrichment-state-locking');
const repoCacheRoot = path.join(tempRoot, 'cache');
const statePath = path.join(repoCacheRoot, 'enrichment_state.json');
const lockPath = path.join(repoCacheRoot, 'locks', 'enrichment-state.lock');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoCacheRoot, { recursive: true });

const heldLock = await acquireFileLock({
  lockPath,
  waitMs: 0,
  timeoutBehavior: 'throw',
  timeoutMessage: 'test lock acquisition failed'
});

let updateSettled = false;
const pendingUpdate = updateEnrichmentState(repoCacheRoot, { status: 'pending' }).then((result) => {
  updateSettled = true;
  return result;
});

await new Promise((resolve) => setTimeout(resolve, 75));
assert.equal(updateSettled, false, 'update should wait while enrichment lock is held');

await heldLock.release({ force: false });
const updateResult = await pendingUpdate;
assert.equal(updateResult?.status, 'pending', 'expected update result after lock release');

const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
assert.equal(state.status, 'pending', 'expected state file to be written after lock release');

await fs.writeFile(statePath, '{not json', 'utf8');
await assert.rejects(
  () => updateEnrichmentState(repoCacheRoot, { queued: true }),
  /json|unexpected/i,
  'expected invalid enrichment state JSON to fail closed'
);

const rawAfterFailure = await fs.readFile(statePath, 'utf8');
assert.equal(rawAfterFailure, '{not json', 'expected invalid state file to remain untouched on parse error');

console.log('enrichment state locking test passed');
