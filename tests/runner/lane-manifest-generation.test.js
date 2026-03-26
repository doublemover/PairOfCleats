#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateLaneManifests, loadOrderedLaneManifest } from './lane-manifests.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pairofcleats-lane-manifests-'));
const testsDir = path.join(tempRoot, 'tests');
const runnerDir = path.join(testsDir, 'runner');
const ciDir = path.join(testsDir, 'ci');
const logDir = path.join(tempRoot, '.testLogs');
fs.mkdirSync(runnerDir, { recursive: true });
fs.mkdirSync(ciDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

fs.writeFileSync(
  path.join(runnerDir, 'lane-manifests.jsonc'),
  `${JSON.stringify({
    orderedLanes: {
      ci: {
        durationBucket: 'ci',
        targetMaxDurationSeconds: 60,
        orderFile: 'tests/ci/ci.order.txt',
        manifestFile: 'tests/ci/ci.manifest.json',
        timingArtifactPaths: [
          '.testLogs/ci-testRunTimes.txt',
          '.testLogs/ci-timings.json'
        ]
      }
    }
  }, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(path.join(ciDir, 'ci.order.txt'), 'alpha\nbeta\n', 'utf8');
fs.writeFileSync(path.join(logDir, 'ci-testRunTimes.txt'), '23ms\talpha\n', 'utf8');
fs.writeFileSync(
  path.join(logDir, 'ci-timings.json'),
  `${JSON.stringify({
    tests: [
      { id: 'beta', durationMs: 47 }
    ]
  }, null, 2)}\n`,
  'utf8'
);

const generated = await generateLaneManifests({ root: tempRoot });
assert.equal(generated.manifests.size, 1, 'expected generated manifest count');

const manifest = await loadOrderedLaneManifest({
  root: tempRoot,
  lane: 'ci',
  config: generated.config
});

assert.equal(manifest?.lane, 'ci');
assert.equal(manifest?.durationBucket, 'ci');
assert.equal(manifest?.targetMaxDurationSeconds, 60);
assert.deepEqual(
  manifest?.tests?.map((entry) => entry.id),
  ['alpha', 'beta'],
  'expected ordered ids preserved'
);
assert.equal(manifest?.tests?.[0]?.durationMs, 23, 'expected log-times duration annotation');
assert.equal(manifest?.tests?.[1]?.durationMs, 47, 'expected timings artifact annotation');
assert.deepEqual(
  manifest?.timingArtifactPaths,
  ['.testLogs/ci-testRunTimes.txt', '.testLogs/ci-timings.json'],
  'expected manifest to record timing artifact sources'
);

console.log('lane manifest generation test passed');
