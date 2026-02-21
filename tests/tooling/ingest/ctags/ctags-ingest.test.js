#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'ctags-ingest');
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

console.log('ctags ingest test passed');

