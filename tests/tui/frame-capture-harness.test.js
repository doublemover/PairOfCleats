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

const supervisedManifest = readJson(
  path.join(outputRoot, 'supervised-session', 'capture-manifest.json')
);
assert.equal(supervisedManifest.fixture_name, 'supervised-session');
assert(supervisedManifest.outputs.length >= 6, 'expected multiple supervised outputs');

const startupFramePath = path.join(
  outputRoot,
  'supervised-session',
  '02-startup',
  'narrow-color.frame.txt'
);
const startupFrame = readText(startupFramePath);
assert.match(startupFrame, /Session/);
assert.match(startupFrame, /Controls/);
assert.match(startupFrame, /Jobs/);
assert.match(startupFrame, /mode=supervised/);
assert.match(startupFrame, /no supervised jobs|supervisor ready/);

const activeMetaPath = path.join(
  outputRoot,
  'supervised-session',
  '07-active',
  'narrow-color.frame.json'
);
const activeMeta = readJson(activeMetaPath);
assert.equal(activeMeta.source_mode, 'supervised');
assert.equal(activeMeta.session_mode, 'supervised');
assert.equal(activeMeta.session_source, 'local-supervisor');
assert.equal(activeMeta.selected_job, 'job-index');
assert(activeMeta.non_default_style_cells > 0, 'expected styled job rows in color capture');

const noColorMetaPath = path.join(
  outputRoot,
  'supervised-session',
  '07-active',
  'wide-no-color.frame.json'
);
const noColorMeta = readJson(noColorMetaPath);
assert.equal(noColorMeta.color, false);
assert.equal(noColorMeta.non_default_style_cells, 0, 'no-color variant should avoid styled cells');

const replayFrame = readText(
  path.join(outputRoot, 'bench-replay', '07-degraded', 'medium-color.frame.txt')
);
assert.match(replayFrame, /mode=replay/);
assert.match(replayFrame, /sourcekit/);
assert.match(replayFrame, /provider degraded/);

const observabilityFrame = readText(
  path.join(outputRoot, 'external-observability', '04-logs-only', 'medium-color.frame.txt')
);
assert.match(observabilityFrame, /mode=external-observability/);
assert.match(observabilityFrame, /external stream without/);
assert.match(observabilityFrame, /attached to external observability/);

const navigationBefore = readJson(
  path.join(outputRoot, 'navigation-scroll', '12-before-scroll', 'medium-color.frame.json')
);
const navigationAfter = readJson(
  path.join(outputRoot, 'navigation-scroll', '16-after-scroll', 'medium-color.frame.json')
);
assert.equal(navigationBefore.job_scroll, 0);
assert.equal(navigationAfter.job_scroll, 1);
assert.equal(navigationAfter.log_scroll, 1);
assert.equal(navigationAfter.selected_job, 'job-b');

console.log('tui frame capture harness test passed');
