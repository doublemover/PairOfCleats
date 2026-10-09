#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { runNode } from '../../../helpers/run-node.js';
import { assertMissingIngestInputFailsCleanly } from '../missing-input-helper.js';

const root = process.cwd();
const suiteRoot = resolveTestCachePath(root, 'scip-ingest');
await fsPromises.mkdir(suiteRoot, { recursive: true });
const tempRoot = await fsPromises.mkdtemp(path.join(suiteRoot, 'roles-'));
const cliPath = path.join(root, 'bin', 'pairofcleats.js');
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const inputPath = path.join(root, 'tests', 'fixtures', 'scip', 'index.json');
const outPath = path.join(tempRoot, 'scip.jsonl');




const result = runNode(
  [cliPath, 'ingest', 'scip', '--repo', repoRoot, '--input', inputPath, '--out', outPath, '--json'],
  'scip ingest',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
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

const masks = [0, 1, 2, 4, 8, 12, 3, 9, 32, 64, 16, 128];
const roleInputPath = path.join(tempRoot, 'role-index.json');
const roleOutPath = path.join(tempRoot, 'roles.jsonl');
await fsPromises.writeFile(roleInputPath, JSON.stringify({
  documents: [{
    relativePath: 'src/roles.js',
    language: 'JavaScript',
    occurrences: [
      ...masks.map((symbolRoles, line) => ({ symbol: 'role-' + symbolRoles, symbolRoles, range: [line, 0, 1] })),
      { symbol: '', symbolRoles: 0, range: [0, 0, 1] }
    ]
  }]
}));
const rolesResult = runNode(
  [cliPath, 'ingest', 'scip', '--repo', repoRoot, '--input', roleInputPath, '--out', roleOutPath, '--json'],
  'scip role ingest', root, process.env,
  { timeoutMs: 10000, stdio: 'pipe', allowFailure: true }
);
assert.equal(rolesResult.status, 0, rolesResult.stderr || rolesResult.stdout);
const rows = fs.readFileSync(roleOutPath, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(rows.length, masks.length, 'nonempty symbol occurrences only');
for (let index = 0; index < masks.length; index++) {
  const row = rows[index], mask = masks[index];
  assert.equal(row.symbolRoles, mask, 'retain the raw bit mask, including unknown bits');
  assert.equal(row.role, (mask & 1) ? 'definition' : 'reference', 'only definition bit controls classification');
  for (const [name, bit] of Object.entries({ isImport: 2, isWriteAccess: 4, isReadAccess: 8, isGenerated: 16, isTest: 32, isForwardDefinition: 64 })) {
    assert.equal(row[name], Boolean(mask & bit), name + ' independent flag for mask ' + mask);
  }
}
const rolesMeta = JSON.parse(fs.readFileSync(roleOutPath + '.meta.json', 'utf8'));
const expectedCounts = { documents: 1, occurrences: 12, definitions: 3, references: 9, imports: 2, writes: 2, reads: 3, generated: 1, tests: 1, forwardDefinitions: 1, errors: 0 };
for (const [name, expected] of Object.entries(expectedCounts)) assert.equal(rolesMeta.stats[name], expected, name);
assert.equal(rolesMeta.stats.definitions + rolesMeta.stats.references, rolesMeta.stats.occurrences, 'definition plus import never double counts references');

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
const escapeResult = runNode(
  [cliPath, 'ingest', 'scip', '--repo', repoRoot, '--input', escapeInputPath, '--out', escapeOutPath, '--json'],
  'scip escape ingest',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
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
assertMissingIngestInputFailsCleanly({
  cliPath,
  kind: 'scip',
  repoRoot,
  missingInputPath,
  outPath: path.join(tempRoot, 'missing.jsonl')
});

console.log('scip ingest test passed');

