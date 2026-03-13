#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildPythonChunksFromAst, buildPythonRelations } from '../../../src/lang/python.js';

applyTestEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, '..', 'fixtures', 'python', 'package-boundary.py');
const text = fs.readFileSync(fixturePath, 'utf8');

const pythonAst = {
  defs: [
    {
      name: 'Widget',
      kind: 'ClassDeclaration',
      startLine: 5,
      startCol: 0,
      endLine: 7,
      endCol: 22,
      fields: ['run']
    },
    {
      name: 'helper_task',
      kind: 'FunctionDeclaration',
      startLine: 10,
      startCol: 0,
      endLine: 11,
      endCol: 24,
      params: ['value']
    }
  ],
  imports: ['pkg', '.subpackage'],
  usages: ['api', 'helper'],
  calls: [['helper_task', 'api.call']],
  callDetails: [{ caller: 'helper_task', callee: 'api.call', line: 11 }],
  exports: ['Widget', 'helper_task']
};

const chunks = buildPythonChunksFromAst(text, pythonAst) || [];
assert.equal(chunks.length, 2, 'expected deterministic chunk count from python AST defs');
assert.deepEqual(
  chunks.map((chunk) => chunk.name),
  ['Widget', 'helper_task'],
  'expected chunk names from python AST defs'
);
assert.equal(chunks[0]?.kind, 'ClassDeclaration', 'expected first python AST chunk to be class declaration');
assert.equal(chunks[1]?.kind, 'FunctionDeclaration', 'expected second python AST chunk to be function declaration');

const relations = buildPythonRelations(text, pythonAst);
assert.deepEqual(relations.imports, ['pkg', '.subpackage'], 'expected package + relative boundary imports');
assert.deepEqual(relations.exports, ['Widget', 'helper_task'], 'expected exports from python AST payload');
assert.deepEqual(relations.calls, [['helper_task', 'api.call']], 'expected deterministic python AST call edges');
assert.deepEqual(relations.callDetails, [{ caller: 'helper_task', callee: 'api.call', line: 11 }], 'expected python AST callDetails passthrough');

console.log('python AST chunk and relation wiring test passed');
