#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { getPythonAst, shutdownPythonAstPool } from '../src/lang/python.js';

function hasPython() {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
}

if (!hasPython()) {
  console.log('Python AST worker test skipped (python not available).');
  process.exit(0);
}

const sample = `
def add(a: int, b: int) -> int:
    return a + b
`;

const ast = await getPythonAst(sample, null, {
  dataflow: true,
  controlFlow: true,
  pythonAst: { workerCount: 1, maxWorkers: 1, taskTimeoutMs: 5000 }
});

if (!ast || !Array.isArray(ast.defs)) {
  console.error('Python AST worker returned no defs.');
  process.exit(1);
}
const hasAdd = ast.defs.some((entry) => entry?.name === 'add');
if (!hasAdd) {
  console.error('Python AST worker missing add() definition.');
  process.exit(1);
}

console.log('Python AST worker test passed');
shutdownPythonAstPool();
