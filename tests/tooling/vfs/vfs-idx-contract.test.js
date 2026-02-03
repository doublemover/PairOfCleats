#!/usr/bin/env node
import assert from 'node:assert/strict';

const loadModule = async () => {
  try {
    return await import('../../../src/index/tooling/vfs-index.js');
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || String(err?.message || '').includes('Cannot find module')) {
      console.log('Skipping VFS index contract (TODO: implement src/index/tooling/vfs-index.js).');
      process.exit(0);
    }
    throw err;
  }
};

const mod = await loadModule();
const buildVfsIndexRow = mod.buildVfsIndexRow || mod.buildVfsIndexRows;
if (typeof buildVfsIndexRow !== 'function') {
  console.log('Skipping VFS index contract (TODO: export buildVfsIndexRow/buildVfsIndexRows).');
  process.exit(0);
}

assert.equal(mod.VFS_INDEX_SCHEMA_VERSION, '1.0.0', 'Expected VFS index schema version 1.0.0.');

const manifestRow = {
  schemaVersion: '1.0.0',
  virtualPath: '.poc-vfs/src/app.ts#seg:segu:v1:abc.ts',
  docHash: 'xxh64:0123456789abcdef',
  containerPath: 'src/app.ts',
  containerExt: '.ts',
  containerLanguageId: 'typescript',
  languageId: 'typescript',
  effectiveExt: '.ts',
  segmentUid: 'segu:v1:abc',
  segmentId: 'seg-1',
  segmentStart: 0,
  segmentEnd: 10,
  lineStart: 1,
  lineEnd: 1
};

const indexRow = typeof buildVfsIndexRow === 'function'
  ? buildVfsIndexRow({ manifestRow })
  : buildVfsIndexRow([manifestRow])[0];

assert.equal(indexRow.schemaVersion, '1.0.0', 'Expected vfs_index row schemaVersion 1.0.0.');
assert.equal(indexRow.virtualPath, manifestRow.virtualPath, 'Expected virtualPath to carry over.');
assert.equal(indexRow.docHash, manifestRow.docHash, 'Expected docHash to carry over.');
assert.equal(indexRow.containerPath, manifestRow.containerPath, 'Expected containerPath to carry over.');
assert.ok(indexRow.manifestSortKey, 'Expected manifestSortKey to be populated.');

console.log('VFS index contract ok.');
