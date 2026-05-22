#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createDisabledAnalysisPolicy,
  createProcessChunksFixtureContext,
  processFixtureChunks
} from './process-chunks-fixture.js';

const runCase = async ({ relPath, text }) => {
  const { context, logs } = createProcessChunksFixtureContext({
    text,
    ext: '.cpp',
    rel: relPath,
    languageId: 'clike',
    segmentUid: `seg-${relPath}`,
    segmentName: 'vendor_symbol',
    lang: { id: 'clike', extractDocMeta: () => ({}) },
    tokenizeEnabled: false,
    riskAnalysisEnabled: false,
    riskConfig: {},
    typeInferenceEnabled: false,
    analysisPolicy: createDisabledAnalysisPolicy()
  });
  const result = await processFixtureChunks(context);
  return { result, logs };
};

const tinyVendor = await runCase({
  relPath: 'vendor/foo.cpp',
  text: 'int vendor_symbol() { return 42; }\n'
});
assert.equal(tinyVendor.result.chunks.length, 1, 'expected one chunk result for tiny vendor file');
assert.ok(
  !tinyVendor.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for vendor/foo.cpp')),
  'expected tiny vendor file to avoid heavy-file downshift'
);

const nestedThirdparty = await runCase({
  relPath: 'tests/thirdparty/Fuzzer/test/TraceMallocTest.cpp',
  text: 'int nested_fixture_symbol() { return 7; }\n'
});
assert.equal(nestedThirdparty.result.chunks.length, 1, 'expected one chunk result for nested thirdparty fixture file');
assert.ok(
  !nestedThirdparty.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for tests/thirdparty/Fuzzer/test/TraceMallocTest.cpp')),
  'expected nested tests/thirdparty fixture paths to avoid heavy-file downshift'
);

const largeVendorText = `${Array.from({ length: 1300 }, (_, i) => `int vendor_symbol_${i} = ${i};`).join('\n')}\n`;
const largeVendor = await runCase({
  relPath: 'vendor/large.cpp',
  text: largeVendorText
});
assert.equal(largeVendor.result.chunks.length, 1, 'expected one chunk result for large vendor file');
assert.ok(
  largeVendor.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for vendor/large.cpp')),
  'expected heavy-file downshift to trigger for root-level vendor path once file size/line pressure is high'
);

const largeSwiftFixtureText = `${Array.from({ length: 1300 }, (_, i) => `public let swift_fixture_${i} = ${i}`).join('\n')}\n`;
const largeSwiftFixture = await runCase({
  relPath: 'test/api-digester/Inputs/SDK.swift',
  text: largeSwiftFixtureText
});
assert.equal(largeSwiftFixture.result.chunks.length, 1, 'expected one chunk result for large swift fixture path');
assert.ok(
  largeSwiftFixture.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for test/api-digester/Inputs/SDK.swift')),
  'expected heavy-file downshift to trigger for known heavy swift fixture path'
);

console.log('heavy file root-path downshift test passed');
