#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initBuildState } from '../../../src/index/build/build-state.js';
import { applyStatePatch } from '../../../src/index/build/build-state/store.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-repeat-logs-'));
const buildRoot = path.join(tempRoot, 'build');
const eventsPath = path.join(buildRoot, 'build_state.events.jsonl');
const deltasPath = path.join(buildRoot, 'build_state.deltas.jsonl');
const event = { type: 'checkpoint', stage: 'stage1', ts: '2026-03-12T00:00:00.000Z' };
const patch = {
  currentPhase: 'processing',
  progress: {
    code: {
      processed: 1,
      total: 2
    }
  }
};

try {
  await initBuildState({
    buildRoot,
    buildId: 'state-repeat-logs',
    repoRoot: tempRoot,
    modes: ['code'],
    stage: 'stage1',
    configHash: 'cfg',
    toolVersion: 'test',
    repoProvenance: { provider: 'none' },
    signatureVersion: 1
  });

  await applyStatePatch(buildRoot, patch, [event]);
  await applyStatePatch(buildRoot, patch, [event]);

  const [eventsText, deltasText] = await Promise.all([
    fs.readFile(eventsPath, 'utf8'),
    fs.readFile(deltasPath, 'utf8')
  ]);
  assert.equal(eventsText.trim().split('\n').length, 2, 'expected identical repeated patch to append events twice');
  assert.ok(deltasText.trim().split('\n').length >= 2, 'expected identical repeated patch to append deltas twice');

  console.log('build state identical patch repeat logs test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
