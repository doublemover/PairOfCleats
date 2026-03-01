#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';
import { buildToolingVirtualDocuments } from '../../../src/index/tooling/vfs.js';

const relPath = 'src/app.js';
const fileText = 'function ping() { return 1; }\n';
const chunk = {
  file: relPath,
  ext: '.js',
  lang: 'javascript',
  start: 0,
  end: fileText.length,
  name: 'ping',
  kind: 'FunctionDeclaration'
};

await assignChunkUids({ chunks: [chunk], fileText, fileRelPath: relPath, strict: true });

const buildOnce = async () => buildToolingVirtualDocuments({
  chunks: [chunk],
  fileTextByPath: new Map([[relPath, fileText]]),
  strict: true
});

const first = await buildOnce();
const second = await buildOnce();

assert.equal(first.documents.length, 1, 'expected one document');
assert.equal(second.documents.length, 1, 'expected one document');
assert.equal(first.documents[0].virtualPath, second.documents[0].virtualPath, 'expected deterministic virtualPath');

console.log('VFS virtualPath determinism test passed');
