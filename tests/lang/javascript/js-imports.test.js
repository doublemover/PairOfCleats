#!/usr/bin/env node
import { collectImports } from '../../../src/lang/javascript.js';

const source = [
  "import fs from 'fs';",
  "import { join as joinPath } from 'path';",
  "export * from 'module-a';",
  "export { foo } from 'module-b';",
  "const mod = require('module-c');",
  "async function load() { return import('module-d'); }"
].join('\n');

const imports = collectImports(source);
const sorted = imports.slice().sort();
const expected = ['fs', 'path', 'module-a', 'module-b', 'module-c', 'module-d'].sort();

if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
  console.error(`JS imports mismatch: ${JSON.stringify(sorted)} !== ${JSON.stringify(expected)}`);
  process.exit(1);
}

console.log('JS imports test passed.');
