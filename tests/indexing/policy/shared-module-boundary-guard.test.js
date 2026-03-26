import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const ledgerPath = path.join(repoRoot, 'docs', 'tooling', 'shared-module-ledger.json');
const waiverPath = path.join(repoRoot, 'docs', 'tooling', 'shared-module-boundary-waivers.json');

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const waivers = JSON.parse(fs.readFileSync(waiverPath, 'utf8'));

const sharedFiles = Array.isArray(ledger?.census?.sharedFiles) ? ledger.census.sharedFiles : [];
const bySharedFile = ledger?.consumerMap?.bySharedFile || {};
const byConsumer = ledger?.consumerMap?.byConsumer || {};
const duplicateOwnership = Array.isArray(ledger?.gaps?.duplicateSharedOwnership)
  ? ledger.gaps.duplicateSharedOwnership
  : [];

assert.deepEqual(duplicateOwnership, [], 'expected no duplicate shared-module ownership entries');

const sharedPathSet = new Set();
let computedEdgeCount = 0;

for (const entry of sharedFiles) {
  assert.ok(typeof entry?.path === 'string' && entry.path.length > 0, 'shared-module census entry missing path');
  assert.ok(!sharedPathSet.has(entry.path), `duplicate census entry for ${entry.path}`);
  sharedPathSet.add(entry.path);

  assert.ok(entry?.primaryIssue && typeof entry.primaryIssue === 'object', `${entry.path}: missing primaryIssue`);
  assert.ok(String(entry.primaryIssue.issueId || '').trim().length > 0, `${entry.path}: missing primaryIssue.issueId`);
  assert.ok(typeof entry.primaryIssue.title === 'string' && entry.primaryIssue.title.trim().length > 0, `${entry.path}: missing primaryIssue.title`);
  assert.ok(typeof entry.primaryIssue.umbrella === 'string' && entry.primaryIssue.umbrella.trim().length > 0, `${entry.path}: missing primaryIssue.umbrella`);

  const importers = Array.isArray(entry.importers) ? entry.importers.slice().sort() : [];
  assert.equal(importers.length, entry.consumerCount, `${entry.path}: consumerCount must match importers length`);

  const consumerEntry = bySharedFile[entry.path];
  assert.ok(consumerEntry && typeof consumerEntry === 'object', `${entry.path}: missing consumerMap.bySharedFile entry`);
  const mappedImporters = Array.isArray(consumerEntry.importers) ? consumerEntry.importers.slice().sort() : [];
  assert.equal(consumerEntry.importerCount, importers.length, `${entry.path}: importerCount mismatch`);
  assert.deepEqual(mappedImporters, importers, `${entry.path}: consumerMap.bySharedFile importer set mismatch`);

  computedEdgeCount += importers.length;
}

assert.equal(
  ledger?.consumerMap?.edgeCount,
  computedEdgeCount,
  'consumerMap.edgeCount must match the sum of census importer edges'
);

for (const [consumerPath, consumerEntry] of Object.entries(byConsumer)) {
  const sharedImports = Array.isArray(consumerEntry?.sharedImports) ? consumerEntry.sharedImports.slice().sort() : [];
  assert.equal(
    consumerEntry.sharedImportCount,
    sharedImports.length,
    `${consumerPath}: sharedImportCount must match sharedImports length`
  );
  for (const sharedPath of sharedImports) {
    assert.ok(sharedPathSet.has(sharedPath), `${consumerPath}: sharedImports references missing shared file ${sharedPath}`);
    const ownerEntry = bySharedFile[sharedPath];
    assert.ok(
      Array.isArray(ownerEntry?.importers) && ownerEntry.importers.includes(consumerPath),
      `${consumerPath}: consumerMap backlink missing for ${sharedPath}`
    );
  }
}

const rule = Array.isArray(waivers?.rules)
  ? waivers.rules.find((entry) => entry?.ruleId === 'src-imports-tools-shared')
  : null;

assert.ok(rule, 'expected src-imports-tools-shared waiver rule');

const waivedEdges = new Map();
for (const waiver of Array.isArray(rule?.waivers) ? rule.waivers : []) {
  assert.ok(typeof waiver?.sharedPath === 'string' && waiver.sharedPath.length > 0, 'waiver missing sharedPath');
  assert.ok(typeof waiver?.importer === 'string' && waiver.importer.length > 0, 'waiver missing importer');
  assert.ok(typeof waiver?.reason === 'string' && waiver.reason.trim().length > 0, 'waiver missing reason');
  const key = `${waiver.sharedPath} -> ${waiver.importer}`;
  assert.ok(!waivedEdges.has(key), `duplicate waiver for ${key}`);
  waivedEdges.set(key, waiver.reason.trim());
}

const activeViolations = [];
for (const entry of sharedFiles) {
  if (!entry.path.startsWith('tools/shared/')) continue;
  for (const importer of entry.importers || []) {
    if (!importer.startsWith('src/')) continue;
    const key = `${entry.path} -> ${importer}`;
    if (!waivedEdges.has(key)) {
      activeViolations.push(key);
    }
  }
}

assert.deepEqual(
  activeViolations,
  [],
  `unwaived src/** -> tools/shared/** imports found: ${activeViolations.join(', ')}`
);

for (const key of waivedEdges.keys()) {
  const [sharedPath, importer] = key.split(' -> ');
  const sharedEntry = bySharedFile[sharedPath];
  assert.ok(sharedEntry, `stale waiver references unknown shared file ${sharedPath}`);
  assert.ok(
    Array.isArray(sharedEntry.importers) && sharedEntry.importers.includes(importer),
    `stale waiver for removed edge ${key}`
  );
}

console.log('shared-module boundary guard passed');
