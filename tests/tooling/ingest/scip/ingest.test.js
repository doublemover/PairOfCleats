#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'scip-ingest');
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'scip', 'index.json');
const outPath = path.join(tempRoot, 'scip.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'scip', '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
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

const escapeInputPath = path.join(tempRoot, 'escape-index.json');
const escapeOutPath = path.join(tempRoot, 'escape-scip.jsonl');
const outsidePath = path.join(root, 'outside.js');
await fsPromises.writeFile(escapeInputPath, JSON.stringify({
  documents: [
    {
      relativePath: 'src/kept.js',
      language: 'javascript',
      occurrences: [{ symbol: 'kept', range: [0, 0, 1], symbolRoles: 1 }]
    },
    {
      relativePath: '../outside.js',
      language: 'javascript',
      occurrences: [{ symbol: 'escaped', range: [0, 0, 1], symbolRoles: 1 }]
    },
    {
      path: outsidePath,
      language: 'javascript',
      occurrences: [{ symbol: 'abs', range: [0, 0, 1], symbolRoles: 1 }]
    }
  ]
}, null, 2));
const escapeResult = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'scip', '--repo', repoRoot, '--input', escapeInputPath, '--out', escapeOutPath, '--json'],
  { encoding: 'utf8' }
);
if (escapeResult.status !== 0) {
  console.error(escapeResult.stderr || escapeResult.stdout || 'scip escape ingest failed');
  process.exit(escapeResult.status ?? 1);
}
const escapedLines = fs.readFileSync(escapeOutPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.equal(escapedLines.length, 1, 'expected out-of-repo scip paths to be dropped');
assert.equal(escapedLines[0].file, 'src/kept.js');
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('..')));
assert.ok(escapedLines.every((entry) => !/^[A-Za-z]:\//.test(entry.file)));
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('/')));

const missingInputPath = path.join(tempRoot, 'missing-scip.json');
const missingResult = spawnSync(
  process.execPath,
  [cliPath, 'ingest', 'scip', '--repo', repoRoot, '--input', missingInputPath, '--out', path.join(tempRoot, 'missing.jsonl'), '--json'],
  { encoding: 'utf8' }
);
assert.notEqual(missingResult.status, 0, 'expected missing input to fail');
const missingOutput = `${missingResult.stderr || ''}${missingResult.stdout || ''}`;
assert.equal(
  missingOutput.includes("Unhandled 'error' event"),
  false,
  'expected missing input failure to avoid unhandled stream error'
);

console.log('scip ingest test passed');

