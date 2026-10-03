#!/usr/bin/env node
import assert from 'node:assert/strict';

import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { createTreeSitterProcessFileCpuFixture } from './tree-sitter-process-file-cpu-fixture.js';

const { createContext: createBaseContext } = await createTreeSitterProcessFileCpuFixture({
  fileHash: 'tree-sitter-language-passes-serialization-gate'
});

const createContext = ({ languagePasses, runTreeSitterSerial }) => ({
  ...createBaseContext(),
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: false,
      languagePasses
    }
  },
  runTreeSitterSerial
});

let serialCallsWithPassesEnabled = 0;
await processFileCpu(createContext({
  languagePasses: true,
  runTreeSitterSerial: async (fn) => {
    serialCallsWithPassesEnabled += 1;
    return fn();
  }
}));
assert.equal(
  serialCallsWithPassesEnabled,
  0,
  'Expected language context pass to avoid tree-sitter serialization when languagePasses=true.'
);

let serialCallsWithPassesDisabled = 0;
await processFileCpu(createContext({
  languagePasses: false,
  runTreeSitterSerial: async (fn) => {
    serialCallsWithPassesDisabled += 1;
    return fn();
  }
}));
assert.ok(
  serialCallsWithPassesDisabled > 0,
  'Expected language context pass to serialize when languagePasses=false.'
);

console.log('tree-sitter language-pass serialization gate test passed');
