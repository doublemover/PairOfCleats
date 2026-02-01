#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildInventory } from '../../../tools/config-inventory.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'config-inventory');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outputJsonPath = path.join(tempRoot, 'config-inventory.json');
const outputMdPath = path.join(tempRoot, 'config-inventory.md');

await buildInventory({
  root,
  schemaPath: path.join(root, 'docs', 'config', 'schema.json'),
  outputJsonPath,
  outputMdPath,
  sourceFiles: [],
  check: false
});

const markdown = await fs.readFile(outputMdPath, 'utf8');
assert.ok(markdown.includes('# Config Inventory'), 'expected header in markdown report');
assert.ok(markdown.includes('## Summary'), 'expected summary section in markdown report');
assert.ok(markdown.includes('Config keys:'), 'expected config keys line in markdown report');

console.log('config-inventory report format test passed');
