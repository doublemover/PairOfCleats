#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  createFileProcessorFixture,
  createFileProcessorForTest,
  createScannedFileEntry,
  writeFixtureFile
} from './file-processor-fixture.js';

const { repoRoot } = await createFileProcessorFixture('read-failure-skip');

const target = await writeFixtureFile({
  root: repoRoot,
  rel: 'missing.js',
  contents: 'console.log("hello");\n'
});
await fsPromises.unlink(target.targetPath);

const skippedFiles = [];
const { processFile } = createFileProcessorForTest({
  root: repoRoot,
  skippedFiles
});

const fileEntry = createScannedFileEntry({
  abs: target.targetPath,
  rel: target.rel,
  stat: target.stat,
  lines: 1
});

const result = await processFile(fileEntry, 0);
if (result !== null) {
  console.error('Expected null result for read failure.');
  process.exit(1);
}
const skip = skippedFiles.find((entry) => entry?.file === target.targetPath && entry?.reason === 'read-failure');
if (!skip) {
  console.error('Expected read-failure skip entry.');
  process.exit(1);
}
if (!skip.code && !skip.message) {
  console.error('Expected read-failure to include error details.');
  process.exit(1);
}

const unreadableDir = path.join(repoRoot, 'unreadable');
await fsPromises.mkdir(unreadableDir, { recursive: true });
const unreadableStat = await fsPromises.stat(unreadableDir);
const unreadableEntry = createScannedFileEntry({
  abs: unreadableDir,
  rel: 'unreadable',
  stat: unreadableStat,
  lines: 1
});

const unreadableResult = await processFile(unreadableEntry, 1);
if (unreadableResult !== null) {
  console.error('Expected null result for unreadable path.');
  process.exit(1);
}
const unreadableSkip = skippedFiles.find((entry) => entry?.file === unreadableDir && entry?.reason === 'unreadable');
if (!unreadableSkip) {
  console.error('Expected unreadable skip entry.');
  process.exit(1);
}

console.log('read-failure skip test passed');

