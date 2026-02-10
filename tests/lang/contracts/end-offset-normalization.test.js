#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildPythonHeuristicChunks } from '../../../src/lang/python.js';
import { buildTypeScriptChunks } from '../../../src/lang/typescript.js';

applyTestEnv();

const pythonSource = [
  'def alpha():',
  '    return 1',
  '',
  'def beta():',
  '    return 2'
].join('\n');
const pythonChunks = buildPythonHeuristicChunks(pythonSource) || [];
const pythonAlpha = pythonChunks.find((chunk) => chunk.name === 'alpha');
const pythonBeta = pythonChunks.find((chunk) => chunk.name === 'beta');
assert.ok(pythonAlpha && pythonBeta, 'expected python chunks for alpha/beta');
assert.ok(pythonAlpha.end <= pythonBeta.start, 'expected python chunk boundaries to use exclusive end offsets');
assert.ok(
  pythonAlpha.meta.endLine < pythonBeta.meta.startLine,
  'expected python endLine to represent the last included line'
);

const tsSource = [
  'export function alpha() {',
  '  return 1;',
  '}',
  'export function beta() {',
  '  return 2;',
  '}'
].join('\n');
const tsChunks = buildTypeScriptChunks(tsSource, { parser: 'heuristic' }) || [];
const tsAlpha = tsChunks.find((chunk) => chunk.name === 'alpha');
const tsBeta = tsChunks.find((chunk) => chunk.name === 'beta');
assert.ok(tsAlpha && tsBeta, 'expected typescript chunks for alpha/beta');
assert.ok(tsAlpha.end <= tsBeta.start, 'expected typescript chunk boundaries to use exclusive end offsets');
assert.ok(
  tsAlpha.meta.endLine < tsBeta.meta.startLine,
  'expected typescript endLine to represent the last included line'
);

console.log('end offset normalization test passed');
