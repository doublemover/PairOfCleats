#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  mergePreflightChecks,
  resolveCommandProfilePreflightResult,
  resolveRuntimeCommandFromPreflight
} from '../../../src/index/tooling/preflight/command-profile-preflight.js';

const ctx = {
  repoRoot: process.cwd(),
  toolingConfig: {}
};

const ready = resolveCommandProfilePreflightResult({
  providerId: 'fixture',
  requestedCommand: {
    cmd: process.execPath,
    args: ['--version']
  },
  ctx,
  unavailableCheck: {
    name: 'fixture_command_unavailable',
    status: 'warn',
    message: 'fixture command unavailable'
  }
});
assert.equal(ready.state, 'ready', 'expected executable command to be ready');
assert.equal(ready.reasonCode, null, 'expected no reasonCode for ready state');
assert.equal(ready.commandProfile?.probe?.ok, true, 'expected successful probe for ready state');

const degraded = resolveCommandProfilePreflightResult({
  providerId: 'fixture',
  requestedCommand: {
    cmd: 'definitely-missing-command-for-preflight-helper-test',
    args: []
  },
  ctx,
  unavailableCheck: {
    name: 'fixture_command_unavailable',
    status: 'warn',
    message: 'fixture command unavailable'
  }
});
assert.equal(degraded.state, 'degraded', 'expected default missing command to degrade');
assert.equal(degraded.reasonCode, 'preflight_command_unavailable', 'expected canonical command-unavailable reason');
assert.equal(
  degraded.check?.name,
  'fixture_command_unavailable',
  'expected missing-command check payload'
);

const blocked = resolveCommandProfilePreflightResult({
  providerId: 'fixture',
  requestedCommand: {
    cmd: 'definitely-missing-command-for-preflight-helper-test',
    args: []
  },
  ctx,
  blockWhenDefinitelyMissing: true,
  blockFlag: 'blockSourcekit',
  unavailableCheck: {
    name: 'fixture_command_unavailable',
    status: 'warn',
    message: 'fixture command unavailable'
  }
});
assert.equal(blocked.state, 'blocked', 'expected missing command to block when configured');
assert.equal(blocked.blockSourcekit, true, 'expected configured block flag to be set');
assert.equal(blocked.definitelyMissing, true, 'expected helper to classify definitely-missing probe');

const runtimeUnknownProbe = resolveRuntimeCommandFromPreflight({
  preflight: {
    requestedCommand: {
      cmd: process.execPath,
      args: ['--version']
    }
  },
  fallbackRequestedCommand: {
    cmd: '',
    args: []
  },
  missingProfileCheck: {
    name: 'fixture_preflight_command_profile_missing',
    status: 'warn',
    message: 'missing profile'
  }
});
assert.equal(runtimeUnknownProbe.cmd, process.execPath, 'expected fallback to requested command cmd');
assert.equal(runtimeUnknownProbe.probeKnown, false, 'expected unknown probe state when preflight has no commandProfile');
assert.equal(runtimeUnknownProbe.probeOk, false, 'expected probeOk false when probe is unknown');
assert.equal(runtimeUnknownProbe.checks.length, 0, 'expected no missing-profile check when command is still resolved');

const dedupedChecks = mergePreflightChecks(
  [{ name: 'a', status: 'warn', message: 'm' }, { name: 'a', status: 'warn', message: 'm' }],
  { name: 'b', status: 'warn', message: 'm2' },
  [{ name: 'b', status: 'warn', message: 'm2' }]
);
assert.equal(dedupedChecks.length, 2, 'expected merged preflight checks to dedupe identical entries');

console.log('preflight command-profile helper test passed');
