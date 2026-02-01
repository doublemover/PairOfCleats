#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-records-'));
const recordsDir = path.join(tempRoot, 'records');
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(recordsDir, { recursive: true });

const recordPath = path.join(recordsDir, 'record.json');
await fs.writeFile(recordPath, '{"id":1}\n');
const codePath = path.join(tempRoot, 'src', 'index.js');
await fs.writeFile(codePath, 'export const value = 1;\n');

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });
const skippedByMode = { code: [], records: [] };
const output = await discoverFilesForModes({
  root: tempRoot,
  modes: ['code', 'records'],
  recordsDir,
  recordsConfig: {},
  ignoreMatcher,
  skippedByMode
});

const recordRel = 'records/record.json';
assert.ok(output.records.some((entry) => entry.rel === recordRel), 'expected record file in records mode');
assert.ok(!output.code.some((entry) => entry.rel === recordRel), 'record file should not be in code mode');
assert.ok(skippedByMode.code.some((entry) => entry.reason === 'records'), 'expected records skip reason for code mode');

console.log('records discovery test passed');
