#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkgDir = path.join(root, 'sublime', 'PairOfCleats');

const collectPyFiles = (dir) => {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
};

const pyFiles = collectPyFiles(pkgDir);
if (!pyFiles.length) {
  console.error('sublime-pycompile: no python files found under', pkgDir);
  process.exit(1);
}

const python = process.env.PYTHON || 'python';
const result = spawnSync(
  python,
  ['-m', 'py_compile', ...pyFiles],
  { encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('sublime-pycompile: python -m py_compile failed');
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.status || 1);
}

console.log(`sublime-pycompile: ok (compiled ${pyFiles.length} files)`);
