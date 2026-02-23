#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveRunSearchModeProfileAvailability } from '../../../src/retrieval/cli/run-search/mode-profile-availability.js';

ensureTestingEnv(process.env);

const telemetryStates = [];
const warnings = [];

const success = await resolveRunSearchModeProfileAvailability({
  runCode: true,
  runProse: false,
  runExtractedProseRaw: true,
  runRecords: false,
  searchMode: 'extracted-prose',
  commentsEnabled: true,
  rootDir: '/repo',
  userConfig: {},
  asOfContext: null,
  indexResolveOptions: {},
  allowSparseFallback: true,
  allowUnsafeMix: false,
  annFlagPresent: true,
  annEnabled: true,
  scoreMode: 'auto',
  emitOutput: true,
  vectorExtension: { enabled: true },
  telemetry: {
    setAnn: (state) => {
      telemetryStates.push(state);
    }
  },
  resolveIndexAvailability: async (input) => {
    input.addProfileWarning('policy warning');
    return {
      annEnabledEffective: false,
      selectedModes: ['code']
    };
  },
  warn: (line) => {
    warnings.push(line);
  }
});

assert.equal(success.error, undefined);
assert.equal(success.requiresExtractedProse, true);
assert.equal(success.joinComments, true);
assert.equal(success.annEnabledEffective, false);
assert.equal(success.vectorAnnEnabled, false);
assert.deepEqual(success.profileWarnings, ['policy warning']);
assert.deepEqual(telemetryStates, ['off']);
assert.deepEqual(warnings, ['[search] policy warning']);
assert.equal(success.modeNeeds.needsSqlite, true);

const failure = await resolveRunSearchModeProfileAvailability({
  runCode: false,
  runProse: true,
  runExtractedProseRaw: false,
  runRecords: false,
  searchMode: 'prose',
  commentsEnabled: false,
  rootDir: '/repo',
  userConfig: {},
  asOfContext: null,
  indexResolveOptions: {},
  allowSparseFallback: true,
  allowUnsafeMix: false,
  annFlagPresent: false,
  annEnabled: true,
  scoreMode: 'auto',
  emitOutput: false,
  vectorExtension: { enabled: true },
  telemetry: { setAnn: () => {} },
  resolveIndexAvailability: async () => ({
    error: Object.assign(new Error('availability failed'), { code: 'E_AVAIL' })
  })
});

assert.equal(failure.error?.message, 'availability failed');
assert.equal(failure.profileAndAvailability, undefined);
assert.equal(typeof failure.syncAnnFlags, 'function');

console.log('run-search mode profile availability test passed');
