#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

ensureTestingEnv(process.env);

const root = process.cwd();
const captureScript = path.join(root, 'tools', 'tui', 'capture-fixtures.js');
const outputRoot = path.join(root, '.testLogs', 'tui', 'frame-capture-test');
await fsPromises.rm(outputRoot, { recursive: true, force: true });

const result = spawnSync(
  process.execPath,
  [captureScript, '--out-dir', outputRoot],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env
    }
  }
);

if (result.status !== 0) {
  console.error('tui frame capture harness test failed: capture script exited non-zero');
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const readFixtureManifest = (fixtureName) =>
  readJson(path.join(outputRoot, fixtureName, 'capture-manifest.json'));
const getCapturePaths = (fixtureManifest, captureId, variantId) => {
  const output = fixtureManifest.outputs.find(
    (entry) => entry.capture_id === captureId && entry.variant_id === variantId
  );
  assert(output, `missing capture ${captureId}/${variantId} in ${fixtureManifest.fixture_name}`);
  return output;
};

const supervisedManifest = readFixtureManifest('supervised-session');
assert.equal(supervisedManifest.fixture_name, 'supervised-session');
assert(supervisedManifest.outputs.length >= 6, 'expected multiple supervised outputs');

const startupFramePath = getCapturePaths(
  supervisedManifest,
  'startup',
  'narrow-color'
).frame_path;
const startupFrame = readText(startupFramePath);
assert.match(startupFrame, /Session/);
assert.match(startupFrame, /Operator/);
assert.match(startupFrame, /Hints/);
assert.match(startupFrame, /Jobs/);
assert.match(startupFrame, /mode supervised/);
assert.match(startupFrame, /no supervised jobs|supervisor ready/);
assert.doesNotMatch(startupFrame, /\{\"connection\"/);

const activeMetaPath = getCapturePaths(
  supervisedManifest,
  'active',
  'narrow-color'
).metadata_path;
const activeMeta = readJson(activeMetaPath);
assert.equal(activeMeta.source_mode, 'supervised');
assert.equal(activeMeta.session_mode, 'supervised');
assert.equal(activeMeta.session_source, 'local-supervisor');
assert.equal(activeMeta.selected_job, 'job-index');
assert(activeMeta.non_default_style_cells > 0, 'expected styled job rows in color capture');

const noColorMetaPath = getCapturePaths(
  supervisedManifest,
  'active',
  'wide-no-color'
).metadata_path;
const noColorMeta = readJson(noColorMetaPath);
assert.equal(noColorMeta.color, false);
assert.equal(noColorMeta.non_default_style_cells, 0, 'no-color variant should avoid styled cells');

const replayManifest = readFixtureManifest('bench-replay');
const replayFrame = readText(
  getCapturePaths(replayManifest, 'degraded', 'medium-color').frame_path
);
assert.match(replayFrame, /mode replay/);
assert.match(replayFrame, /sourcekit/);
assert.match(replayFrame, /provider degraded/);
assert.doesNotMatch(replayFrame, /\{\"event\"/);

const observabilityManifest = readFixtureManifest('external-observability');
const observabilityFrame = readText(
  getCapturePaths(observabilityManifest, 'logs-only', 'medium-color').frame_path
);
assert.match(observabilityFrame, /mode external-observability/);
assert.match(observabilityFrame, /external stream without/);
assert.match(observabilityFrame, /attached to external observability/);
assert.doesNotMatch(observabilityFrame, /\{\"event\"/);

const navigationManifest = readFixtureManifest('navigation-scroll');
const navigationBefore = readJson(
  getCapturePaths(navigationManifest, 'before-scroll', 'medium-color').metadata_path
);
const navigationAfter = readJson(
  getCapturePaths(navigationManifest, 'after-scroll', 'medium-color').metadata_path
);
assert.equal(navigationBefore.job_scroll, 0);
assert.equal(navigationAfter.job_scroll, 1);
assert.equal(navigationAfter.log_scroll, 1);
assert.equal(navigationAfter.selected_job, 'job-b');

const operatorManifest = readFixtureManifest('operator-workflows');
const operatorBaseline = readText(
  getCapturePaths(operatorManifest, 'baseline', 'medium-color').frame_path
);
assert.match(operatorBaseline, /Operator/);
assert.match(operatorBaseline, /focus jobs/);
assert.match(operatorBaseline, /follow live/);

const jobsFilterFrame = readText(
  getCapturePaths(operatorManifest, 'jobs-active-filter', 'medium-color').frame_path
);
assert.match(jobsFilterFrame, /Jobs \* \| filter active/);
assert.match(jobsFilterFrame, /job-b \| running \| Serve A/);
assert.doesNotMatch(jobsFilterFrame, /^│job-a \| failed/m);

const logFilterFrame = readText(
  getCapturePaths(operatorManifest, 'logs-warn-filter', 'medium-color').frame_path
);
assert.match(logFilterFrame, /Logs \* \| filter warn\+\/all/);
assert.match(logFilterFrame, /warn \| supervisor \| watchdog warning/);
assert.match(logFilterFrame, /error \| supervisor \| provider degraded/);
assert.doesNotMatch(logFilterFrame, /background refresh complete/);

const searchFrame = readText(
  getCapturePaths(operatorManifest, 'logs-search', 'medium-color').frame_path
);
assert.match(searchFrame, /search sourcekit/);
assert.match(searchFrame, /sourcekit/);
assert.doesNotMatch(searchFrame, /background refresh complete/);

const pausedFrame = readText(
  getCapturePaths(operatorManifest, 'follow-paused', 'medium-color').frame_path
);
assert.match(pausedFrame, /follow paused/);

const helpFrame = readText(
  getCapturePaths(operatorManifest, 'help-overlay', 'medium-color').frame_path
);
assert.match(helpFrame, /Operator Help/);
assert.match(helpFrame, /Tab switch focus panels/);

const paletteFrame = readText(
  getCapturePaths(operatorManifest, 'palette-open', 'medium-color').frame_path
);
assert.match(paletteFrame, /Actions/);
assert.match(paletteFrame, /Toggle follow \/ pause/);

console.log('tui frame capture harness test passed');
