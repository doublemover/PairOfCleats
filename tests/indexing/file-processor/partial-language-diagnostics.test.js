#!/usr/bin/env node

import {
  createFileProcessorFixture,
  createFileProcessorForTest,
  createScannedFileEntry,
  writeFixtureFile
} from './file-processor-fixture.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { repoRoot } = await createFileProcessorFixture('partial-language-diagnostics');

const source = [
  'include("${CMAKE_CURRENT_SOURCE_DIR}/deps.cmake")',
  'add_subdirectory(src)'
].join('\n');
const target = await writeFixtureFile({
  root: repoRoot,
  rel: 'build.cmake',
  contents: source
});

const { processFile } = createFileProcessorForTest({
  root: repoRoot,
  languageOptions: {
    skipUnknownLanguages: true,
    treeSitter: { enabled: false }
  }
});

const fileEntry = createScannedFileEntry({
  abs: target.targetPath,
  rel: target.rel,
  stat: target.stat,
  lines: source.split('\n').length
});

const result = await processFile(fileEntry, 0);
if (!result?.chunks?.length) {
  fail('Expected cmake file to produce chunks.');
}

const firstChunk = result.chunks[0];
const usrCapabilities = firstChunk?.docmeta?.usrCapabilities;
if (!usrCapabilities || usrCapabilities.state !== 'partial' || usrCapabilities.source !== 'cmake') {
  fail('Expected partial usrCapabilities envelope for cmake chunk.');
}

const diagnostics = Array.isArray(usrCapabilities.diagnostics) ? usrCapabilities.diagnostics : [];
const downgrade = diagnostics.find((entry) =>
  entry?.code === 'USR-W-CAPABILITY-DOWNGRADED' && entry?.reasonCode === 'USR-R-HEURISTIC-ONLY');
if (!downgrade) {
  fail('Expected downgrade diagnostic for import-collector adapter path.');
}

console.log('partial language diagnostics test passed');
