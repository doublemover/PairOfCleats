#!/usr/bin/env node

import {
  createFileProcessorFixture,
  createFileProcessorForTest,
  createScannedFileEntry,
  writeFixtureFile
} from './file-processor-fixture.js';

const { repoRoot } = await createFileProcessorFixture('unsupported-language-skip');

const target = await writeFixtureFile({
  root: repoRoot,
  rel: 'unknown.foo',
  contents: 'just some text\n'
});

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
  console.error('Expected null result for unsupported language.');
  process.exit(1);
}
const skip = skippedFiles.find((entry) => entry?.file === target.targetPath && entry?.reason === 'unsupported-language');
if (!skip) {
  console.error('Expected unsupported-language skip entry.');
  process.exit(1);
}
const diagnostics = Array.isArray(skip.diagnostics) ? skip.diagnostics : [];
const parserUnavailable = diagnostics.find((entry) =>
  entry?.code === 'USR-E-CAPABILITY-LOST' && entry?.reasonCode === 'USR-R-PARSER-UNAVAILABLE');
if (!parserUnavailable) {
  console.error('Expected unsupported-language skip diagnostics with parser-unavailable reason.');
  process.exit(1);
}

console.log('unsupported-language skip test passed');

