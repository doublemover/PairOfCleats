#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lsif-ingest');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'lsif', 'dump.lsif');
const outPath = path.join(tempRoot, 'lsif.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'ingest', 'lsif.js'), '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
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

console.log('lsif ingest test passed');

