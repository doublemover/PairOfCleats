#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'ctags-ingest');
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'ctags', 'tags.jsonl');
const outPath = path.join(tempRoot, 'ctags.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'ctags', '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
  { encoding: 'utf8' }
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'ctags-ingest failed');
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(outPath)) {
  console.error('ctags output not found');
  process.exit(1);
}

const lines = fs.readFileSync(outPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert.ok(lines.length >= 2, 'expected ctags output lines');

const first = JSON.parse(lines[0]);
assert.equal(first.file, 'src/widget.js');
assert.equal(first.name, 'Widget');
assert.equal(first.kind, 'class');
assert.equal(first.language, 'JavaScript');
assert.equal(first.startLine, 3);

const metaPath = `${outPath}.meta.json`;
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
assert.equal(meta.stats.entries, lines.length);

const escapeInputPath = path.join(tempRoot, 'escape-tags.jsonl');
const escapeOutPath = path.join(tempRoot, 'escape-ctags.jsonl');
const outsidePath = path.join(root, 'outside.js');
await fsPromises.writeFile(escapeInputPath, [
  JSON.stringify({ _type: 'tag', name: 'kept', path: 'src/kept.js', line: 1, kind: 'function' }),
  JSON.stringify({ _type: 'tag', name: 'escaped', path: '../outside.js', line: 2, kind: 'function' }),
  JSON.stringify({ _type: 'tag', name: 'absolute', path: outsidePath, line: 3, kind: 'function' })
].join('\n'));
const escapeResult = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'ctags', '--repo', repoRoot, '--input', escapeInputPath, '--out', escapeOutPath, '--json'],
  { encoding: 'utf8' }
);
if (escapeResult.status !== 0) {
  console.error(escapeResult.stderr || escapeResult.stdout || 'ctags escape ingest failed');
  process.exit(escapeResult.status ?? 1);
}
const escapedLines = fs.readFileSync(escapeOutPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.equal(escapedLines.length, 1, 'expected out-of-repo ctags paths to be dropped');
assert.equal(escapedLines[0].file, 'src/kept.js');
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('..')));
assert.ok(escapedLines.every((entry) => !/^[A-Za-z]:\//.test(entry.file)));
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('/')));

console.log('ctags ingest test passed');

