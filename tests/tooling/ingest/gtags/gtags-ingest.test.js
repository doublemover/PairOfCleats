#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'gtags-ingest');
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'gtags', 'gtags.txt');
const outPath = path.join(tempRoot, 'gtags.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'gtags', '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
  { encoding: 'utf8' }
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'gtags-ingest failed');
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(outPath)) {
  console.error('gtags output not found');
  process.exit(1);
}

const lines = fs.readFileSync(outPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert.ok(lines.length >= 2, 'expected gtags output lines');

const first = JSON.parse(lines[0]);
assert.equal(first.file, 'src/widget.js');
assert.equal(first.name, 'Widget');
assert.equal(first.startLine, 3);
assert.equal(first.source, 'gtags');

const metaPath = `${outPath}.meta.json`;
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
assert.equal(meta.stats.entries, lines.length);

const missingInputPath = path.join(tempRoot, 'missing-gtags.txt');
const missingResult = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'gtags', '--repo', repoRoot, '--input', missingInputPath, '--out', path.join(tempRoot, 'missing.jsonl'), '--json'],
  { encoding: 'utf8' }
);
assert.notEqual(missingResult.status, 0, 'expected missing input to fail');
const missingOutput = `${missingResult.stderr || ''}${missingResult.stdout || ''}`;
assert.equal(
  missingOutput.includes("Unhandled 'error' event"),
  false,
  'expected missing input failure to avoid unhandled stream error'
);

console.log('gtags ingest test passed');

