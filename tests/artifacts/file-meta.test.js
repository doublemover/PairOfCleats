#!/usr/bin/env node
import { buildFileMeta } from '../../src/index/build/artifacts/file-meta.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const state = {
  chunks: [
    { file: 'a.js', ext: '.js', fileHash: 'hash-a', fileHashAlgo: 'sha1', fileSize: 10 },
    { file: 'a.js', ext: '.js' },
    { file: 'b.js', ext: '.js', fileHash: 'hash-b', fileHashAlgo: 'sha1', fileSize: 5 }
  ]
};

const { fileMeta, fileIdByPath } = buildFileMeta(state);
if (fileMeta.length !== 2) {
  fail('Expected fileMeta to contain one entry per file.');
}
if (fileMeta[0].file !== 'a.js' || fileMeta[0].id !== 0) {
  fail('Expected a.js to be assigned id 0.');
}
if (fileMeta[1].file !== 'b.js' || fileMeta[1].id !== 1) {
  fail('Expected b.js to be assigned id 1.');
}
if (fileMeta[0].hash !== 'hash-a' || fileMeta[0].hashAlgo !== 'sha1') {
  fail('Expected a.js to include file hash fields.');
}
if (fileMeta[1].hash !== 'hash-b' || fileMeta[1].hashAlgo !== 'sha1') {
  fail('Expected b.js to include file hash fields.');
}
if (fileIdByPath.get('a.js') !== 0 || fileIdByPath.get('b.js') !== 1) {
  fail('Expected fileIdByPath to map files to stable ids.');
}

console.log('artifact file meta tests passed');
