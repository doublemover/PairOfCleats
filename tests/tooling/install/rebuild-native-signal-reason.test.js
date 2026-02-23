#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatSpawnFailureReason } from '../../../tools/setup/rebuild-native-exit.js';

assert.equal(
  formatSpawnFailureReason({ status: null, signal: 'SIGTERM' }),
  'signal SIGTERM'
);
assert.equal(
  formatSpawnFailureReason({ status: 3, signal: null }),
  'exit 3'
);
assert.equal(
  formatSpawnFailureReason({ status: null, signal: null, error: { message: 'spawn ENOENT' } }),
  'spawn ENOENT'
);
assert.equal(
  formatSpawnFailureReason({ status: null, signal: null }),
  'exit unknown'
);

console.log('rebuild-native signal reason test passed');
