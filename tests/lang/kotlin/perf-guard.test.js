#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildKotlinChunks, buildKotlinRelations, computeKotlinFlow, getKotlinFileStats } from '../../../src/lang/kotlin.js';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = 'class Widget {\n fun render(a: Int): Int {\n if (a > 0) { foo() }\n return a\n }\n}\n';
const chunks = buildKotlinChunks(text, {}) || [];
const target = chunks.find((chunk) => chunk.kind === 'MethodDeclaration' || chunk.kind === 'FunctionDeclaration');
if (!target) {
  console.error('Missing Kotlin function chunk for perf guard test.');
  process.exit(1);
}

const stats = getKotlinFileStats(text);
const fullOptions = {
  stats,
  kotlin: {
    flowMaxBytes: 10 * 1024,
    flowMaxLines: 100,
    relationsMaxBytes: 10 * 1024,
    relationsMaxLines: 100
  }
};
const skipOptions = {
  stats,
  kotlin: {
    flowMaxBytes: 1,
    flowMaxLines: 1,
    relationsMaxBytes: 1,
    relationsMaxLines: 1
  }
};

const flowFull = computeKotlinFlow(text, target, { ...fullOptions, dataflow: true, controlFlow: true });
assert.ok(flowFull && flowFull.controlFlow, 'Expected flow metadata for Kotlin chunk.');

const flowSkipped = computeKotlinFlow(text, target, { ...skipOptions, dataflow: true, controlFlow: true });
assert.equal(flowSkipped, null, 'Expected flow metadata to be skipped for large Kotlin file.');

const { context } = await buildLanguageContext({ ext: '.kt', relPath: 'Widget.kt', mode: 'code', text,
  options: { treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false } } });
const nativeChunks = context.kotlinChunks;
assert.ok(nativeChunks?.some(chunk => chunk.name === 'Widget.render'));
const relationsFull = buildKotlinRelations(text, nativeChunks, fullOptions);
assert.ok(relationsFull.calls.some((entry) => entry[1] && entry[1].includes('foo')),
  'Expected Kotlin calls to include foo().');

const relationsSkipped = buildKotlinRelations(text, nativeChunks, skipOptions);
assert.equal(relationsSkipped.calls.length, 0, 'Expected Kotlin relations to be skipped.');

console.log('kotlin perf guard test passed');
