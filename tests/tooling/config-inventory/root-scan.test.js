#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSourceFiles } from '../../../tools/config/inventory/scan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const suiteRoot = path.join(root, 'temp', 'tasks', 'config-inventory-root-scan');
await fs.mkdir(suiteRoot, { recursive: true });
const runRoot = await fs.mkdtemp(path.join(suiteRoot, 'fixture-'));
const scanRoot = path.join(runRoot, 'temp', 'worktrees', 'repository');
const retained = ['main.js', 'src/main.js', 'tools/scan.js'];
const excluded = [
  'temp/skip.js', '.testCache/skip.js', '.testLogs/skip.js', 'tests/.cache/skip.js',
  '.cache/skip.js', '.logs/skip.js', '.venv/skip.js', '.diagnostics/skip.js',
  'node_modules/skip.js', '.git/skip.js', 'worktrees/skip.js', '.worktrees/skip.js',
  'benchmarks/repos/skip.js', 'benchmarks/cache/skip.js', 'benchmarks/results/skip.js',
  'src/notes.txt'
];
for (const relative of [...retained, ...excluded]) {
  const target = path.join(scanRoot, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, '// fixture\n');
}
const selected = (await listSourceFiles(scanRoot))
  .map((file) => path.relative(scanRoot, file).replaceAll('\\', '/')).sort();
assert.deepEqual(selected, retained.slice().sort(),
  'exclude repository-local caches, not ancestor temp/worktree path components');
console.log('config inventory root-relative scanner test passed');
