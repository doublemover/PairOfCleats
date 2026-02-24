#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const incrementalRunnerPath = path.join(root, 'src', 'storage', 'sqlite', 'build', 'runner', 'incremental.js');
const source = await fs.readFile(incrementalRunnerPath, 'utf8');

assert.match(
  source,
  /from\s+['"]\.\.\/imports\.js['"]/,
  'expected incremental runner helper to import capability from ../imports.js'
);
assert.doesNotMatch(
  source,
  /from\s+['"]\.\.\/index\.js['"]/,
  'expected incremental runner helper to avoid ../index.js barrel coupling'
);

console.log('incremental runner imports contract test passed');
