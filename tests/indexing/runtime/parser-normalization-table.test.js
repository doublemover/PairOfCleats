#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeLanguageFlowConfig,
  normalizeLanguageParserConfig
} from '../../../src/index/build/runtime/normalize.js';

const defaults = normalizeLanguageParserConfig({});
assert.deepEqual(defaults, {
  javascript: 'babel',
  typescript: 'auto'
});

const topLevelOnly = normalizeLanguageParserConfig({
  javascriptParser: 'esprima',
  typescriptParser: 'heuristic'
});
assert.deepEqual(topLevelOnly, {
  javascript: 'esprima',
  typescript: 'heuristic'
});

const nestedPrecedence = normalizeLanguageParserConfig({
  javascriptParser: 'acorn',
  javascript: { parser: 'babel' },
  typescriptParser: 'heuristic',
  typescript: { parser: 'typescript' }
});
assert.deepEqual(nestedPrecedence, {
  javascript: 'babel',
  typescript: 'typescript'
});

const invalidFallback = normalizeLanguageParserConfig({
  javascriptParser: 'invalid-parser',
  typescript: { parser: 'unsupported' }
});
assert.deepEqual(invalidFallback, {
  javascript: 'babel',
  typescript: 'auto'
});

const flowTopLevel = normalizeLanguageFlowConfig({
  javascriptFlow: 'off'
});
assert.deepEqual(flowTopLevel, { javascript: 'off' });

const flowNestedPrecedence = normalizeLanguageFlowConfig({
  javascriptFlow: 'off',
  javascript: { flow: 'on' }
});
assert.deepEqual(flowNestedPrecedence, { javascript: 'on' });

const deterministicA = normalizeLanguageParserConfig({
  javascript: { parser: 'babel' },
  typescriptParser: 'heuristic'
});
const deterministicB = normalizeLanguageParserConfig({
  typescriptParser: 'heuristic',
  javascript: { parser: 'babel' }
});
assert.deepEqual(deterministicA, deterministicB, 'parser normalization must be deterministic across key ordering');

console.log('parser normalization table test passed');
