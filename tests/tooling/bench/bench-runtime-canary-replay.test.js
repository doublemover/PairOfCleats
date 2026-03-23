#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  loadBenchRuntimeCanaryManifest,
  replayBenchRuntimeCanary
} from '../../../tools/bench/language/canaries.js';

const { manifest } = await loadBenchRuntimeCanaryManifest(process.cwd());
const byId = new Map((manifest.entries || []).map((entry) => [entry.id, entry]));

const swift = await replayBenchRuntimeCanary(byId.get('swift-nio-timeout'), process.cwd());
assert.deepEqual(
  swift.eventTypes,
  ['runtime_timeout', 'runtime_timeout_budget_extended'],
  'expected timeout canary structured events'
);

const gopls = await replayBenchRuntimeCanary(byId.get('gopls-blocked-partitions'), process.cwd());
assert.equal(gopls.eventTypes.includes('provider_preflight_blocked'), true);
assert.equal(gopls.eventTypes.includes('workspace_partition_decision'), true);

const parser = await replayBenchRuntimeCanary(byId.get('parser-crash-quarantine'), process.cwd());
assert.equal(parser.failureClasses.includes('grammar:json'), true);

console.log('bench runtime canary replay test passed');
