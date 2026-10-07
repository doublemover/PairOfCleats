#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runHeavyFileProcessCase } from './heavy-file-process-case-helper.js';

ensureTestingEnv(process.env);

const runCase = async ({ relKey, lineCount, chunkCount }) => {
  const { result } = await runHeavyFileProcessCase({
    languageId: 'swift',
    extension: '.swift',
    relKey,
    lineCount,
    chunkCount,
    sourceLine: (i) => `let swift_line_${i} = ${i}`,
    languageOptions: {
      heavyFile: {
        maxChunks: 64,
        swiftHotPathTargetChunks: 24,
        swiftHotPathMinChunks: 48
      }
    },
    tokenizeEnabled: false
  });
  return result;
};

const baseline = await runCase({
  relKey: 'src/FastPath.swift',
  lineCount: 900,
  chunkCount: 96
});
assert.equal(baseline.chunks.length, 48, 'expected non-hot-path Swift file to coalesce to default heavy chunk target');

const hotPath = await runCase({
  relKey: 'test/Sema/exhaustive_switch.swift',
  lineCount: 900,
  chunkCount: 96
});
assert.equal(hotPath.chunks.length, 24, 'expected Swift benchmark hot-path file to coalesce more aggressively');

console.log('heavy file swift hot-path coalescing test passed');
