#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildInventory } from '../../../tools/config-inventory.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'config-inventory-sync');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outputJsonPath = path.join(tempRoot, 'inventory.json');
const outputMdPath = path.join(tempRoot, 'inventory.md');

await buildInventory({
  root,
  schemaPath: path.join(root, 'docs', 'config', 'schema.json'),
  outputJsonPath,
  outputMdPath,
  check: false
});

const stripGeneratedAt = (payload) => {
  const clone = JSON.parse(JSON.stringify(payload));
  if (clone && typeof clone === 'object') delete clone.generatedAt;
  return clone;
};

const normalizeMd = (text) => text
  .replace(/^Generated: .*$/m, 'Generated: <timestamp>')
  .trim();

const expectedJson = JSON.parse(await fs.readFile(path.join(root, 'docs', 'config', 'inventory.json'), 'utf8'));
const actualJson = JSON.parse(await fs.readFile(outputJsonPath, 'utf8'));
assert.deepStrictEqual(stripGeneratedAt(actualJson), stripGeneratedAt(expectedJson), 'config inventory json out of sync');

const expectedMd = normalizeMd(await fs.readFile(path.join(root, 'docs', 'config', 'inventory.md'), 'utf8'));
const actualMd = normalizeMd(await fs.readFile(outputMdPath, 'utf8'));
assert.strictEqual(actualMd, expectedMd, 'config inventory markdown out of sync');

console.log('config inventory sync test passed');
