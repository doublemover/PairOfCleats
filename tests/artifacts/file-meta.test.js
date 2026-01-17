#!/usr/bin/env node
import { buildFileMeta } from '../../src/index/build/artifacts/file-meta.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const state = {
  chunks: [
    { file: 'b.js', ext: '.js' },
    { file: 'a.js', ext: '.js' },
    { file: 'a.js', ext: '.js' }
  ],
  fileInfoByPath: new Map([
    ['a.js', { size: 10, hash: 'abc123', hashAlgo: 'sha1' }],
    ['b.js', { size: 20, hash: 'def456', hashAlgo: 'sha1' }]
  ])
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
if (fileIdByPath.get('a.js') !== 0 || fileIdByPath.get('b.js') !== 1) {
  fail('Expected fileIdByPath to map files to stable ids.');
}
if (fileMeta[0].size !== 10 || fileMeta[0].hash !== 'abc123' || fileMeta[0].hash_algo !== 'sha1') {
  fail('Expected file_meta to include size/hash metadata for a.js.');
}
if (fileMeta[1].size !== 20 || fileMeta[1].hash !== 'def456' || fileMeta[1].hash_algo !== 'sha1') {
  fail('Expected file_meta to include size/hash metadata for b.js.');
}

console.log('artifact file meta tests passed');
