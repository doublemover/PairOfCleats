#!/usr/bin/env node
import { getPythonAst, shutdownPythonAstPool } from '../../src/lang/python.js';
import { findPythonExecutable } from '../../src/lang/python/executable.js';

const sample = 'def add(a: int, b: int) -> int:\\n    return a + b\\n';
const originalPath = process.env.PATH;
process.env.PATH = '';

const pythonBin = await findPythonExecutable();
if (pythonBin) {
  const ast = await getPythonAst(sample, null, {
    pythonAst: { workerCount: 1, maxWorkers: 1, taskTimeoutMs: 5000 }
  });
  if (!ast || !Array.isArray(ast.defs)) {
    console.error('Expected AST payload when python is available.');
    process.exit(1);
  }
} else {
  const ast = await getPythonAst(sample, null, {
    pythonAst: { workerCount: 1, maxWorkers: 1, taskTimeoutMs: 5000 }
  });
  if (ast !== null) {
    console.error('Expected null AST when python is not available.');
    process.exit(1);
  }
}

shutdownPythonAstPool();
shutdownPythonAstPool();
process.env.PATH = originalPath;

console.log('Python pool test passed.');
