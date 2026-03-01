#!/usr/bin/env node
import assert from 'node:assert/strict';

import { VFS_MANIFEST_MAX_ROW_BYTES, trimVfsManifestRow } from '../../../src/index/tooling/vfs.js';

const baseRow = {
  schemaVersion: '1.0.0',
  virtualPath: '.poc-vfs/docs/guide.md#seg:segu:v1:abc.ts',
  docHash: 'xxh64:deadbeef',
  containerPath: 'docs/guide.md',
  containerExt: '.md',
  containerLanguageId: 'markdown',
  languageId: 'typescript',
  effectiveExt: '.ts',
  segmentUid: 'segu:v1:abc',
  segmentId: 'seg-1',
  segmentStart: 0,
  segmentEnd: 10,
  lineStart: 1,
  lineEnd: 1
};

const oversized = {
  ...baseRow,
  segmentId: 's'.repeat(40000),
  extensions: { blob: 'x'.repeat(20000) }
};

const stats = { trimmedRows: 0, droppedRows: 0 };
const trimmed = trimVfsManifestRow(oversized, { stats });
assert.ok(trimmed, 'expected row to be trimmed, not dropped');
assert.equal(trimmed.extensions, undefined, 'extensions should be dropped first');
assert.equal(trimmed.segmentId, null, 'segmentId should be nulled when still oversize');
assert.equal(stats.trimmedRows, 1, 'trimmedRows should count once');
assert.equal(stats.droppedRows, 0, 'row should not be dropped');
const trimmedBytes = Buffer.byteLength(JSON.stringify(trimmed), 'utf8');
assert.ok(trimmedBytes <= VFS_MANIFEST_MAX_ROW_BYTES, 'trimmed row should fit within max');

const dropStats = { trimmedRows: 0, droppedRows: 0 };
const hugePath = {
  ...baseRow,
  containerPath: 'a'.repeat(VFS_MANIFEST_MAX_ROW_BYTES * 2),
  virtualPath: `.poc-vfs/${'a'.repeat(VFS_MANIFEST_MAX_ROW_BYTES * 2)}`
};
const dropped = trimVfsManifestRow(hugePath, { stats: dropStats });
assert.equal(dropped, null, 'row should be dropped when still oversize');
assert.equal(dropStats.droppedRows, 1, 'droppedRows should increment');

console.log('VFS trim order test passed');
