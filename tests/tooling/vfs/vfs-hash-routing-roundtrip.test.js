#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildToolingVirtualDocuments,
  buildVfsHashVirtualPath
} from '../../../src/index/tooling/vfs.js';

const fileText = 'console.log(1);\n';
const chunks = [
  {
    file: 'src/App.vue',
    lang: 'typescript',
    ext: '.vue',
    containerLanguageId: 'vue',
    segment: {
      segmentUid: 'segu:v1:hash',
      segmentId: 'seg-hash',
      start: 0,
      end: fileText.length,
      languageId: 'typescript',
      ext: '.ts'
    },
    chunkUid: 'chunk:1',
    start: 0,
    end: fileText.length,
    fileHash: 'deadbeef'
  }
];

const fileTextByPath = new Map([['src/App.vue', fileText]]);

const { documents } = await buildToolingVirtualDocuments({
  chunks,
  fileTextByPath,
  hashRouting: true,
  strict: true
});

assert.equal(documents.length, 1);
const doc = documents[0];
assert.ok(doc.virtualPath.startsWith('.poc-vfs/by-hash/'));
const expectedHashPath = buildVfsHashVirtualPath({
  docHash: doc.docHash,
  effectiveExt: doc.effectiveExt
});
assert.equal(doc.virtualPath, expectedHashPath);
assert.equal(
  doc.legacyVirtualPath,
  '.poc-vfs/src/App.vue#seg:segu:v1:hash.ts'
);

const plain = await buildToolingVirtualDocuments({
  chunks,
  fileTextByPath,
  hashRouting: false,
  strict: true
});
assert.equal(plain.documents.length, 1);
assert.equal(plain.documents[0].legacyVirtualPath, null);
assert.equal(
  plain.documents[0].virtualPath,
  '.poc-vfs/src/App.vue#seg:segu:v1:hash.ts'
);

console.log('vfs hash routing ok');
