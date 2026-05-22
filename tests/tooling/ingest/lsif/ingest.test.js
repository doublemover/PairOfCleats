#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { runNode } from '../../../helpers/run-node.js';
import { assertMissingIngestInputFailsCleanly } from '../missing-input-helper.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsif-ingest');
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'lsif', 'dump.lsif');
const outPath = path.join(tempRoot, 'lsif.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });


const result = runNode(
  [cliPath, 'ingest', 'lsif', '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
  'lsif ingest',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
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

const escapeInputPath = path.join(tempRoot, 'escape.lsif');
const escapeOutPath = path.join(tempRoot, 'escape-lsif.jsonl');
await fsPromises.writeFile(escapeInputPath, [
  JSON.stringify({ id: 1, type: 'vertex', label: 'document', uri: 'file:///repo/src/kept.ts', languageId: 'typescript' }),
  JSON.stringify({ id: 2, type: 'vertex', label: 'document', uri: 'file:///repo/../outside.ts', languageId: 'typescript' }),
  JSON.stringify({ id: 3, type: 'vertex', label: 'document', uri: 'not a valid uri', languageId: 'typescript' }),
  JSON.stringify({ id: 10, type: 'vertex', label: 'range', start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }),
  JSON.stringify({ id: 11, type: 'vertex', label: 'range', start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }),
  JSON.stringify({ id: 12, type: 'vertex', label: 'range', start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }),
  JSON.stringify({ id: 100, type: 'vertex', label: 'definitionResult' }),
  JSON.stringify({ id: 101, type: 'vertex', label: 'definitionResult' }),
  JSON.stringify({ id: 102, type: 'vertex', label: 'definitionResult' }),
  JSON.stringify({ id: 200, type: 'edge', label: 'contains', outV: 1, inVs: [10] }),
  JSON.stringify({ id: 201, type: 'edge', label: 'contains', outV: 2, inVs: [11] }),
  JSON.stringify({ id: 202, type: 'edge', label: 'contains', outV: 3, inVs: [12] }),
  JSON.stringify({ id: 300, type: 'edge', label: 'item', outV: 10, inVs: [100] }),
  JSON.stringify({ id: 301, type: 'edge', label: 'item', outV: 11, inVs: [101] }),
  JSON.stringify({ id: 302, type: 'edge', label: 'item', outV: 12, inVs: [102] })
].join('\n'));
const escapeResult = runNode(
  [cliPath, 'ingest', 'lsif', '--repo', repoRoot, '--input', escapeInputPath, '--out', escapeOutPath, '--json'],
  'lsif escape ingest',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
);
if (escapeResult.status !== 0) {
  console.error(escapeResult.stderr || escapeResult.stdout || 'lsif escape ingest failed');
  process.exit(escapeResult.status ?? 1);
}
const escapedLines = fs.readFileSync(escapeOutPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.equal(escapedLines.length, 1, 'expected out-of-repo lsif paths to be dropped');
assert.equal(escapedLines[0].file, 'src/kept.ts');
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('..')));
assert.ok(escapedLines.every((entry) => !/^[A-Za-z]:\//.test(entry.file)));
assert.ok(escapedLines.every((entry) => !entry.file.startsWith('/')));

const missingInputPath = path.join(tempRoot, 'missing.lsif');
assertMissingIngestInputFailsCleanly({
  cliPath,
  kind: 'lsif',
  repoRoot,
  missingInputPath,
  outPath: path.join(tempRoot, 'missing.jsonl')
});

console.log('lsif ingest test passed');

