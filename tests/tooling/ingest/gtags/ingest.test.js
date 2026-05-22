#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { runNode } from '../../../helpers/run-node.js';
import { assertMissingIngestInputFailsCleanly } from '../missing-input-helper.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'gtags-ingest');
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'gtags', 'gtags.txt');
const outPath = path.join(tempRoot, 'gtags.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = runNode(
  [cliPath, 'ingest', 'gtags', '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
  'gtags ingest',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
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
const escapeResult = runNode(
  [cliPath, 'ingest', 'gtags', '--repo', repoRoot, '--input', escapeInputPath, '--out', escapeOutPath, '--json'],
  'gtags escape ingest',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
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
assertMissingIngestInputFailsCleanly({
  cliPath,
  kind: 'gtags',
  repoRoot,
  missingInputPath,
  outPath: path.join(tempRoot, 'missing.jsonl')
});

console.log('gtags ingest test passed');

