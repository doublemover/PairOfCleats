#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createVfsManifestCollector } from '../../../src/index/build/vfs-manifest-collector.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-vfs-collector-isolation-'));
applyTestEnv({ cacheRoot: tempRoot });

const makeRow = (name) => ({
  virtualPath: `${name}.js`,
  docHash: `hash-${name}`,
  containerPath: null,
  effectiveExt: '.js',
  languageId: 'javascript'
});

const collectorA = createVfsManifestCollector({
  buildRoot: tempRoot,
  maxBufferRows: 1,
  maxBufferBytes: 1
});
const collectorB = createVfsManifestCollector({
  buildRoot: tempRoot,
  maxBufferRows: 1,
  maxBufferBytes: 1
});

await collectorA.appendRows([makeRow('a')]);
await collectorB.appendRows([makeRow('b')]);

const finalizedA = await collectorA.finalize();
const finalizedB = await collectorB.finalize();

assert.ok(Array.isArray(finalizedA.runs) && finalizedA.runs.length > 0, 'expected spilled runs for collector A');
assert.ok(Array.isArray(finalizedB.runs) && finalizedB.runs.length > 0, 'expected spilled runs for collector B');

const runDirA = path.dirname(finalizedA.runs[0]);
const runDirB = path.dirname(finalizedB.runs[0]);
assert.notEqual(runDirA, runDirB, 'expected isolated run directories per collector');

await finalizedA.cleanup();
await fs.access(finalizedB.runs[0]);

await finalizedB.cleanup();
const runsParent = path.join(tempRoot, 'vfs_manifest.runs');
await assert.rejects(fs.access(runsParent), 'expected shared runs parent to be removed when empty');

console.log('vfs manifest collector isolation test passed');
