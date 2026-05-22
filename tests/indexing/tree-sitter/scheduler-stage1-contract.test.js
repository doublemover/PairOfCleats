#!/usr/bin/env node
import assert from 'node:assert/strict';

import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { createTreeSitterProcessFileCpuFixture } from '../file-processor/tree-sitter-process-file-cpu-fixture.js';

const noop = () => {};
const { createContext } = await createTreeSitterProcessFileCpuFixture({
  fileHash: 'scheduler-stage1-contract'
});

function createMissingChunkScheduler(onLoad, extras = {}) {
  return {
    ...extras,
    loadChunks: async () => {
      onLoad();
      return null;
    }
  };
}

function createProcessFileOptions({
  mode = 'code',
  treeSitter = { enabled: true, strict: false },
  treeSitterScheduler = null,
  logLine = noop
} = {}) {
  return createContext({
    mode,
    languageOptions: {
      treeSitter
    },
    logLine,
    treeSitterScheduler
  });
}

let schedulerCalls = 0;
const treeSitterScheduler = createMissingChunkScheduler(() => {
  schedulerCalls += 1;
});

await assert.rejects(
  async () =>
    processFileCpu(
      createProcessFileOptions({
        treeSitter: {
          enabled: true,
          strict: true
        },
        treeSitterScheduler
      })
    ),
  /Missing scheduled chunks/
);
assert.ok(schedulerCalls > 0, 'expected scheduler to be consulted for tree-sitter chunks');

let fallbackSchedulerCalls = 0;
const fallbackScheduler = createMissingChunkScheduler(() => {
  fallbackSchedulerCalls += 1;
}, {
  index: new Map()
});
const fallbackResult = await processFileCpu(
  createProcessFileOptions({
    treeSitter: {
      enabled: true,
      strict: false
    },
    treeSitterScheduler: fallbackScheduler
  })
);
assert.ok(fallbackSchedulerCalls > 0, 'expected scheduler lookup attempts in non-strict mode');
assert.ok(Array.isArray(fallbackResult?.chunks) && fallbackResult.chunks.length > 0, 'expected fallback chunking to produce chunks');

let unsupportedLanguageSchedulerCalls = 0;
const unsupportedLanguageWarnings = [];
const unsupportedLanguageScheduler = createMissingChunkScheduler(() => {
  unsupportedLanguageSchedulerCalls += 1;
}, {
  index: new Map(),
  scheduledLanguageIds: new Set(['lua'])
});
const unsupportedLanguageResult = await processFileCpu(
  createProcessFileOptions({
    treeSitter: {
      enabled: true,
      strict: false
    },
    treeSitterScheduler: unsupportedLanguageScheduler,
    logLine: (line) => unsupportedLanguageWarnings.push(String(line || ''))
  })
);
assert.equal(
  unsupportedLanguageSchedulerCalls,
  0,
  'expected scheduler lookup to be skipped when scheduler has no coverage for the language'
);
assert.ok(
  Array.isArray(unsupportedLanguageResult?.chunks) && unsupportedLanguageResult.chunks.length > 0,
  'expected fallback chunking to produce chunks when scheduler lacks language coverage'
);
assert.equal(
  unsupportedLanguageWarnings.some((line) => line.includes('[tree-sitter:schedule] scheduler missing')),
  false,
  'expected no scheduler-missing warning spam when language coverage is absent'
);

const proseResult = await processFileCpu(
  createProcessFileOptions({
    mode: 'prose',
    treeSitter: {
      enabled: false
    }
  })
);
assert.ok(Array.isArray(proseResult?.chunks), 'expected prose mode to complete without scheduler');

console.log('tree-sitter scheduler stage1 contract ok');

