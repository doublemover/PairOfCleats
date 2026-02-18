#!/usr/bin/env node
import assert from 'node:assert/strict';

import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const pythonLang = LANGUAGE_REGISTRY.find((entry) => entry?.id === 'python');
assert.ok(pythonLang && typeof pythonLang.prepare === 'function', 'expected python adapter prepare function');

const source = [
  'import os',
  'from pkg import helper',
  '',
  'def run():',
  '  return helper()'
].join('\n');

const generatedLogs = [];
const generatedContext = await pythonLang.prepare({
  text: source,
  mode: 'code',
  relPath: 'pygments/lexers/_lasso_builtins.py',
  options: {
    log: (line) => generatedLogs.push(String(line)),
    pythonAst: { enabled: true }
  }
});
assert.equal(generatedContext.pythonAst ?? null, null, 'expected generated python paths to skip AST');
assert.equal(generatedContext.pythonAstMetrics ?? null, null, 'expected generated python paths to skip AST metrics');
assert.ok(
  Array.isArray(generatedContext.pythonChunks) && generatedContext.pythonChunks.length > 0,
  'expected generated python paths to keep heuristic chunking'
);
assert.ok(
  generatedLogs.some((line) => line.includes('[python-ast] skip pygments/lexers/_lasso_builtins.py (generated-path).')),
  'expected generated python path skip reason log'
);

const sizeLogs = [];
const sizeContext = await pythonLang.prepare({
  text: source,
  mode: 'code',
  relPath: 'src/heavy.py',
  options: {
    log: (line) => sizeLogs.push(String(line)),
    fileSizeBytes: 300000,
    pythonAst: { enabled: true, skipHeavyBytes: 1024 }
  }
});
assert.equal(sizeContext.pythonAst ?? null, null, 'expected large python files to skip AST by byte policy');
assert.ok(
  sizeLogs.some((line) => line.includes('[python-ast] skip src/heavy.py (max-bytes).')),
  'expected max-bytes skip reason log'
);
assert.ok(
  Array.isArray(sizeContext.pythonChunks) && sizeContext.pythonChunks.length > 0,
  'expected large python files to keep heuristic chunking'
);

console.log('python ast heavy-file skip policy test passed');
