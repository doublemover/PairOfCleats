#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsif-ingest');
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'lsif', 'dump.lsif');
const outPath = path.join(tempRoot, 'lsif.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'lsif', '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
  { encoding: 'utf8' }
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'lsif-ingest failed');
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(outPath)) {
  console.error('lsif output not found');
  process.exit(1);
}

const lines = fs.readFileSync(outPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert.ok(lines.length >= 1, 'expected lsif output lines');

const first = JSON.parse(lines[0]);
assert.equal(first.file, 'src/sample.ts');
assert.equal(first.role, 'definition');
assert.equal(first.startLine, 2);
assert.equal(first.language, 'typescript');

const metaPath = `${outPath}.meta.json`;
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
assert.ok(meta.stats.vertices >= 4);
assert.ok(meta.stats.edges >= 2);
assert.ok(meta.stats.definitions >= 1);
assert.ok(meta.stats.references >= 1);

const missingInputPath = path.join(tempRoot, 'missing.lsif');
const missingResult = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'lsif', '--repo', repoRoot, '--input', missingInputPath, '--out', path.join(tempRoot, 'missing.jsonl'), '--json'],
  { encoding: 'utf8' }
);
assert.notEqual(missingResult.status, 0, 'expected missing input to fail');
const missingOutput = `${missingResult.stderr || ''}${missingResult.stdout || ''}`;
assert.equal(
  missingOutput.includes("Unhandled 'error' event"),
  false,
  'expected missing input failure to avoid unhandled stream error'
);

console.log('lsif ingest test passed');

