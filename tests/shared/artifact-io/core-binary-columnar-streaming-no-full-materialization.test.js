#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

applyTestEnv();

const root = process.cwd();
const testRoot = path.join(root, '.testLogs', 'artifact-io-core-binary-columnar-streaming-no-full-materialization');
await fsPromises.rm(testRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(testRoot, 'pieces'), { recursive: true });

const rows = [
  { id: 0, file: 'src/a.js', ext: '.js', size: 12 },
  { id: 1, file: 'src/b.ts', ext: '.ts', size: 42 },
  { id: 2, file: 'README.md', ext: '.md', size: 7 }
];
const encoded = encodeBinaryRowFrames(rows.map((entry) => Buffer.from(JSON.stringify(entry), 'utf8')));

const dataPath = path.join(testRoot, 'sample.binary-columnar.bin');
const offsetsPath = path.join(testRoot, 'sample.binary-columnar.offsets.bin');
const lengthsPath = path.join(testRoot, 'sample.binary-columnar.lengths.varint');
await fsPromises.writeFile(dataPath, encoded.dataBuffer);
await fsPromises.writeFile(offsetsPath, encoded.offsetsBuffer);
await fsPromises.writeFile(lengthsPath, encoded.lengthsBuffer);
await fsPromises.writeFile(
  path.join(testRoot, 'sample.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: rows.length,
      data: 'sample.binary-columnar.bin',
      offsets: 'sample.binary-columnar.offsets.bin',
      lengths: 'sample.binary-columnar.lengths.varint'
    }
  }, null, 2)
);
await writePiecesManifest(testRoot, [
  { name: 'sample', path: 'sample.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'sample_binary_columnar_offsets', path: 'sample.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'sample_binary_columnar_lengths', path: 'sample.binary-columnar.lengths.varint', format: 'varint' },
  { name: 'sample_binary_columnar_meta', path: 'sample.binary-columnar.meta.json', format: 'json' }
]);

const originalReadFileSync = fs.readFileSync;
const resolvedDataPath = path.resolve(dataPath);
let fullDataReadCount = 0;
fs.readFileSync = (targetPath, ...args) => {
  if (typeof targetPath === 'string' && path.resolve(targetPath) === resolvedDataPath) {
    fullDataReadCount += 1;
    throw new Error('unexpected full data read');
  }
  return originalReadFileSync.call(fs, targetPath, ...args);
};

const streamed = [];
try {
  for await (const row of loadJsonArrayArtifactRows(testRoot, 'sample', { strict: true })) {
    streamed.push(row);
  }
} finally {
  fs.readFileSync = originalReadFileSync;
}

assert.deepEqual(streamed, rows, 'expected binary-columnar streaming rows to preserve payload values');
assert.equal(fullDataReadCount, 0, 'expected streaming binary-columnar path to avoid full data readFileSync materialization');

console.log('core binary-columnar streaming no full materialization test passed');
