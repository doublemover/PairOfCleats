import { buildFileMeta } from '../../../src/index/build/artifacts/file-meta.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const stateA = {
  chunks: [
    { file: 'b.js', ext: '.js', fileHash: 'hash-b', fileHashAlgo: 'sha1', fileSize: 4 },
    { file: 'a.js', ext: '.js', fileHash: 'hash-a', fileHashAlgo: 'sha1', fileSize: 2 }
  ],
  fileInfoByPath: new Map([
    ['a.js', { size: 2, hash: 'hash-a', hashAlgo: 'sha1' }],
    ['b.js', { size: 4, hash: 'hash-b', hashAlgo: 'sha1' }]
  ])
};

const stateB = {
  chunks: [
    { file: 'a.js', ext: '.js', fileHash: 'hash-a', fileHashAlgo: 'sha1', fileSize: 2 },
    { file: 'b.js', ext: '.js', fileHash: 'hash-b', fileHashAlgo: 'sha1', fileSize: 4 }
  ],
  fileInfoByPath: new Map([
    ['a.js', { size: 2, hash: 'hash-a', hashAlgo: 'sha1' }],
    ['b.js', { size: 4, hash: 'hash-b', hashAlgo: 'sha1' }]
  ])
};

const { fileMeta: metaA, fileIdByPath: mapA } = buildFileMeta(stateA);
const { fileMeta: metaB, fileIdByPath: mapB } = buildFileMeta(stateB);

if (mapA.get('a.js') !== mapB.get('a.js') || mapA.get('b.js') !== mapB.get('b.js')) {
  fail('Expected file ids to remain stable across chunk ordering changes.');
}
if (metaA[0].file !== 'a.js' || metaA[0].id !== 0) {
  fail('Expected a.js to be id 0 in stable ordering.');
}
if (metaA[1].file !== 'b.js' || metaA[1].id !== 1) {
  fail('Expected b.js to be id 1 in stable ordering.');
}
if (metaB[0].file !== 'a.js' || metaB[0].id !== 0) {
  fail('Expected a.js to be id 0 in stable ordering (state B).');
}

console.log('file meta stable ids test passed');
