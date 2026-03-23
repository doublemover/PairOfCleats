#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';

import {
  loadBenchRuntimeCanaryManifest,
  replayBenchRuntimeCanary
} from '../../../tools/bench/language/canaries.js';

const { canaryRoot, manifest } = await loadBenchRuntimeCanaryManifest(process.cwd());

assert.equal(manifest?.schemaVersion, 1, 'expected canary manifest schema version');
assert.ok(Array.isArray(manifest?.entries), 'expected canary entries array');
assert.equal(manifest.entries.length >= 7, true, 'expected critical canary coverage');

for (const entry of manifest.entries) {
  assert.ok(entry?.id, 'expected canary id');
  assert.ok(entry?.file, 'expected canary file');
  await fsPromises.access(new URL(`file:///${canaryRoot.replace(/\\/g, '/')}/${entry.file}`));
  const replay = await replayBenchRuntimeCanary(entry, process.cwd());
  for (const eventType of entry.requiredEventTypes || []) {
    assert.equal(
      replay.eventTypes.includes(eventType),
      true,
      `expected ${entry.id} to emit ${eventType}`
    );
  }
  for (const failureClass of entry.requiredFailureClasses || []) {
    assert.equal(
      replay.failureClasses.includes(failureClass),
      true,
      `expected ${entry.id} to emit failure class ${failureClass}`
    );
  }
  for (const pattern of entry.requiredPatterns || []) {
    assert.equal(
      replay.matchedPatterns.includes(pattern),
      true,
      `expected ${entry.id} to contain pattern ${pattern}`
    );
  }
}

console.log('bench runtime canary corpus test passed');
