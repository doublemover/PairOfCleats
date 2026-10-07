#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runHeavyFileProcessCase } from './heavy-file-process-case-helper.js';

ensureTestingEnv(process.env);

const runCase = ({ relKey, lineCount, chunkCount }) => {
  return runHeavyFileProcessCase({
    languageId: 'java',
    extension: '.java',
    relKey,
    lineCount,
    chunkCount,
    sourceLine: (i) => `int line_${i} = ${i};`,
    tokenizeEnabled: true,
    languageOptions: {}
  });
};

const moderateJava = await runCase({
  relKey: 'junit-jupiter-params/src/main/java/org/junit/jupiter/params/ResolverFacade.java',
  lineCount: 770,
  chunkCount: 76
});
assert.equal(moderateJava.result.chunks.length, 76, 'expected moderate Java file to keep original chunk count');
assert.ok(
  !moderateJava.logs.some((line) => line.includes('[perf] heavy-file downshift enabled')),
  'expected moderate Java file with many chunks to avoid heavy-file downshift'
);
assert.ok(
  !moderateJava.logs.some((line) => line.includes('[perf] heavy-file tokenization skipped')),
  'expected moderate Java file with many chunks to keep tokenization'
);

const largeJava = await runCase({
  relKey: 'junit-jupiter-engine/src/main/java/org/junit/jupiter/engine/descriptor/ClassBasedTestDescriptor.java',
  lineCount: 2200,
  chunkCount: 80
});
assert.ok(
  largeJava.logs.some((line) => line.includes('[perf] heavy-file downshift enabled')),
  'expected sufficiently large Java file to still downshift'
);
assert.ok(
  largeJava.result.chunks.length < 80,
  'expected sufficiently large Java file downshift to coalesce chunk count'
);

console.log('heavy file java chunk threshold test passed');
