#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildLuaChunks, buildLuaRelations, collectLuaImports } from '../../../src/lang/lua.js';

applyTestEnv();

const luaText = [
  "local util = require 'app.util'",
  "require('app.sub')",
  '',
  'local M = {}',
  '',
  'function M:render(task)',
  '  util.run(task)',
  '  return task',
  'end',
  '',
  'local function helper(task)',
  '  return M.render(M, task)',
  'end',
  '',
  'return M'
].join('\n');

const chunks = buildLuaChunks(luaText) || [];
assert.equal(chunks.some((chunk) => chunk.kind === 'MethodDeclaration' && chunk.name === 'M.render'), true, 'expected module method chunk');
assert.equal(chunks.some((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'helper'), true, 'expected local helper function chunk');

const imports = collectLuaImports(luaText).slice().sort();
assert.deepEqual(imports, ['app.sub', 'app.util'], 'expected dotted lua require imports');

const relations = buildLuaRelations(luaText, chunks);
assert.equal(
  relations.calls.some(([caller, callee]) => caller === 'M.render' && (callee === 'util.run' || callee === 'run')),
  true,
  'expected method call relation for util.run'
);
assert.equal(
  relations.calls.some(([caller, callee]) => caller === 'helper' && (callee === 'M.render' || callee === 'render')),
  true,
  'expected helper call relation for M.render'
);

console.log('lua module import and relation wiring test passed');
