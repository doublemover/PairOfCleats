#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'scip-ingest');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'scip', 'index.json');
const outPath = path.join(tempRoot, 'scip.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'ingest', 'scip.js'), '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
  { encoding: 'utf8' }
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'scip-ingest failed');
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(outPath)) {
  console.error('scip output not found');
  process.exit(1);
}

const lines = fs.readFileSync(outPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert.ok(lines.length >= 2, 'expected scip output lines');

const first = JSON.parse(lines[0]);
assert.equal(first.file, 'src/example.js');
assert.equal(first.name, 'doThing');
assert.equal(first.role, 'definition');
assert.equal(first.startLine, 2);

const metaPath = `${outPath}.meta.json`;
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
assert.equal(meta.stats.occurrences, lines.length);
assert.equal(meta.stats.definitions, 1);
assert.equal(meta.stats.references, 1);

console.log('scip ingest test passed');

