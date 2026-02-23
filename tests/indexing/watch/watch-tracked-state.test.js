import assert from 'node:assert/strict';
import {
  applyClassificationToTrackedState,
  buildDiscoveryForMode,
  createTrackedState,
  removeTrackedPathFromModes,
  seedTrackedStateForMode
} from '../../../src/index/build/watch/tracked-state.js';

const modes = ['code', 'prose', 'extracted-prose', 'records'];
const sourcePath = '/repo/src/app.js';

{
  const state = createTrackedState();
  const changed = applyClassificationToTrackedState({
    state,
    absPath: sourcePath,
    modes,
    classification: {
      skip: false,
      relPosix: 'src/app.js',
      ext: '.js',
      stat: { size: 32 },
      record: null,
      isSpecial: false
    },
    maxFilesCap: null
  });
  assert.equal(changed, true, 'expected first classification to change tracked membership');
  assert.equal(state.trackedCounts.get(sourcePath), 2, 'expected code file to be tracked in code + extracted-prose');

  const codeDiscovery = buildDiscoveryForMode(state, 'code');
  assert.equal(codeDiscovery.entries.length, 1, 'expected code discovery to include source path');
  assert.equal(codeDiscovery.entries[0].abs, sourcePath);
  assert.equal(buildDiscoveryForMode(state, 'prose').entries.length, 0, 'expected prose discovery to exclude source path');
  assert.equal(
    buildDiscoveryForMode(state, 'records').skippedFiles.find((entry) => entry.file === sourcePath)?.reason,
    'unsupported',
    'expected records mode to mark non-record files unsupported'
  );

  removeTrackedPathFromModes(state, sourcePath);
  assert.equal(state.trackedCounts.has(sourcePath), false, 'expected remove helper to clear tracked counts');
}

{
  const state = createTrackedState();
  applyClassificationToTrackedState({
    state,
    absPath: sourcePath,
    modes,
    classification: {
      skip: false,
      relPosix: 'src/app.js',
      ext: '.js',
      stat: { size: 32 },
      record: null,
      isSpecial: false
    },
    maxFilesCap: null
  });
  const changed = applyClassificationToTrackedState({
    state,
    absPath: sourcePath,
    modes,
    classification: {
      skip: true,
      reason: 'ignored'
    },
    maxFilesCap: null
  });
  assert.equal(changed, true, 'expected skip classification to remove previously tracked entry');
  assert.equal(state.trackedCounts.has(sourcePath), false, 'expected ignored file to be removed from tracked set');
  assert.equal(
    buildDiscoveryForMode(state, 'code').skippedFiles.find((entry) => entry.file === sourcePath)?.reason,
    'ignored',
    'expected skip reason to be recorded for code mode'
  );
}

{
  const state = createTrackedState();
  const recordPath = '/repo/triage/records/item.md';
  const changed = applyClassificationToTrackedState({
    state,
    absPath: recordPath,
    modes,
    classification: {
      skip: false,
      relPosix: 'triage/records/item.md',
      ext: '.md',
      stat: { size: 17 },
      record: {
        source: 'triage',
        recordType: 'record',
        reason: 'records-dir'
      },
      isSpecial: false
    },
    maxFilesCap: null
  });
  assert.equal(changed, true, 'expected records classification to change tracked membership');
  assert.equal(state.trackedCounts.get(recordPath), 1, 'expected records entry to be tracked in records mode only');
  assert.equal(buildDiscoveryForMode(state, 'records').entries.length, 1, 'expected records discovery to include records file');
  assert.equal(
    buildDiscoveryForMode(state, 'code').skippedFiles.find((entry) => entry.file === recordPath)?.reason,
    'records',
    'expected code mode to skip records-routed entries'
  );
}

{
  const state = createTrackedState();
  seedTrackedStateForMode({
    state,
    mode: 'code',
    entries: [
      {
        abs: '/repo/src/existing.js',
        rel: 'src/existing.js',
        ext: '.js',
        stat: { size: 1 }
      }
    ],
    skippedEntries: []
  });
  const changed = applyClassificationToTrackedState({
    state,
    absPath: '/repo/src/new.js',
    modes: ['code', 'prose'],
    classification: {
      skip: false,
      relPosix: 'src/new.js',
      ext: '.js',
      stat: { size: 2 },
      record: null,
      isSpecial: false
    },
    maxFilesCap: 1
  });
  assert.equal(changed, false, 'expected max-files cap to reject new path without changing tracked membership');
  assert.equal(state.trackedCounts.has('/repo/src/new.js'), false, 'expected capped path not to become tracked');
  assert.equal(
    buildDiscoveryForMode(state, 'code').skippedFiles.find((entry) => entry.file === '/repo/src/new.js')?.reason,
    'max-files',
    'expected max-files skip reason for capped path'
  );
}

console.log('watch tracked-state tests passed');
