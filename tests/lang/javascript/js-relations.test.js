#!/usr/bin/env node
import { buildCodeRelations } from '../../../src/lang/javascript.js';

const source = [
  "import { readFile } from 'fs';",
  'export function run(path) {',
  '  return readFile(path);',
  '}',
  'const local = () => run("x");',
  'module.exports = { run };'
].join('\n');

const rel = buildCodeRelations(source, 'sample.js', { fs: ['fs.js'] }) || {};
const calls = Array.isArray(rel.calls) ? rel.calls : [];
const imports = Array.isArray(rel.imports) ? rel.imports : [];
const exports = Array.isArray(rel.exports) ? rel.exports : [];

const hasCall = calls.some(([from, to]) => from === 'run' && to === 'readFile');
if (!hasCall) {
  console.error(`Missing call relation from run -> readFile: ${JSON.stringify(calls)}`);
  process.exit(1);
}

if (!imports.includes('fs')) {
  console.error(`Missing import for fs: ${JSON.stringify(imports)}`);
  process.exit(1);
}

if (!exports.includes('run') || !exports.includes('default')) {
  console.error(`Missing exports for run/default: ${JSON.stringify(exports)}`);
  process.exit(1);
}

console.log('JS relations test passed.');
