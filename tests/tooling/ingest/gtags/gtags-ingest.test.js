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

const escapeInputPath = path.join(tempRoot, 'escape-gtags.txt');
const escapeOutPath = path.join(tempRoot, 'escape-gtags.jsonl');
const outsidePath = path.join(root, 'outside.js');
await fsPromises.writeFile(escapeInputPath, [
  'kept 1 src/kept.js',
  'escaped 2 ../outside.js',
  `absolute 3 ${outsidePath}`
].join('\n'));
const escapeResult = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'gtags', '--repo', repoRoot, '--input', escapeInputPath, '--out', escapeOutPath, '--json'],
  { encoding: 'utf8' }
);
if (escapeResult.status !== 0) {
  console.error(escapeResult.stderr || escapeResult.stdout || 'gtags escape ingest failed');
  process.exit(escapeResult.status ?? 1);
}
const escapedLines = fs.readFileSync(escapeOutPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.equal(escapedLines.length, 1, 'expected out-of-repo gtags paths to be dropped');
assert.equal(escapedLines[0].file, 'src/kept.js');
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('..')));
assert.ok(escapedLines.every((entry) => !/^[A-Za-z]:\//.test(entry.file)));
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('/')));

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

