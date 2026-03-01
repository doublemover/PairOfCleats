#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildVfsIndexRows } from '../../../src/index/tooling/vfs-index.js';
import { compareVfsManifestRows } from '../../../src/index/tooling/vfs.js';

const rows = [
  {
    schemaVersion: '1.0.0',
    virtualPath: '.poc-vfs/b.ts#seg:seg-b.ts',
    docHash: 'xxh64:bbbbbbbbbbbbbbbb',
    containerPath: 'b.ts',
    containerExt: '.ts',
    containerLanguageId: 'typescript',
    languageId: 'typescript',
    effectiveExt: '.ts',
    segmentUid: 'seg-b',
    segmentId: 'seg-b',
    segmentStart: 5,
    segmentEnd: 10,
    lineStart: 1,
    lineEnd: 1
  },
  {
    schemaVersion: '1.0.0',
    virtualPath: '.poc-vfs/a.ts#seg:seg-a.ts',
    docHash: 'xxh64:aaaaaaaaaaaaaaaa',
    containerPath: 'a.ts',
    containerExt: '.ts',
    containerLanguageId: 'typescript',
    languageId: 'typescript',
    effectiveExt: '.ts',
    segmentUid: 'seg-a',
    segmentId: 'seg-a',
    segmentStart: 0,
    segmentEnd: 4,
    lineStart: 1,
    lineEnd: 1
  }
];

const indexRows = buildVfsIndexRows(rows);
assert.equal(indexRows.length, rows.length, 'Expected one index row per manifest row.');
for (const row of indexRows) {
  assert.ok(row.manifestSortKey, 'Expected manifestSortKey to be populated.');
}

const sortedManifest = rows.slice().sort(compareVfsManifestRows).map((row) => row.virtualPath);
const sortedIndex = indexRows
  .slice()
  .sort((a, b) => String(a.manifestSortKey).localeCompare(String(b.manifestSortKey)))
  .map((row) => row.virtualPath);

assert.deepStrictEqual(sortedIndex, sortedManifest, 'Expected index sort keys to match manifest ordering.');

console.log('vfs index lookup ok');
