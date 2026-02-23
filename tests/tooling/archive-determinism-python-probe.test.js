#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertPinnedPackagingToolchain } from '../../tools/tooling/archive-determinism.js';

const calls = [];
const linuxProbe = (command) => {
  calls.push(command);
  if (command === 'python3') return { status: 127 };
  if (command === 'python') return { status: 0 };
  return { status: 1 };
};

assert.doesNotThrow(() => {
  assertPinnedPackagingToolchain({
    requirePython: true,
    platform: 'linux',
    probeSpawnSync: linuxProbe
  });
});
assert.deepEqual(calls, ['python3', 'python'], 'expected linux probe order to check python3 then python');

assert.throws(
  () => assertPinnedPackagingToolchain({
    requirePython: true,
    platform: 'linux',
    probeSpawnSync: () => ({ status: 127 })
  }),
  /Python runtime is required but unavailable\./
);

const overrideCalls = [];
assert.doesNotThrow(() => {
  assertPinnedPackagingToolchain({
    requirePython: true,
    platform: 'linux',
    pythonBinaries: ['custom-python', 'python'],
    probeSpawnSync: (command) => {
      overrideCalls.push(command);
      return { status: command === 'custom-python' ? 0 : 127 };
    }
  });
});
assert.deepEqual(overrideCalls, ['custom-python'], 'expected custom python binary override order');

const throwProbeCalls = [];
assert.doesNotThrow(() => {
  assertPinnedPackagingToolchain({
    requirePython: true,
    platform: 'linux',
    probeSpawnSync: (command) => {
      throwProbeCalls.push(command);
      if (command === 'python3') {
        throw new Error('spawn failed');
      }
      return { status: command === 'python' ? 0 : 127 };
    }
  });
});
assert.deepEqual(
  throwProbeCalls,
  ['python3', 'python'],
  'expected thrown probe errors to fall through to remaining candidates'
);

console.log('archive determinism python probe test passed');
