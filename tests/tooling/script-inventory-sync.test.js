#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'script-inventory-sync');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outputJsonPath = path.join(tempRoot, 'script-inventory.json');
const outputMdPath = path.join(tempRoot, 'commands.md');

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'script-inventory.js'),
    '--json',
    outputJsonPath,
    '--markdown',
    outputMdPath
  ],
  { cwd: root, encoding: 'utf8' }
);
if (result.status !== 0) {
  console.error('script inventory sync test failed: generator exited non-zero.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const stripGeneratedAt = (payload) => {
  const clone = JSON.parse(JSON.stringify(payload));
  if (clone && typeof clone === 'object') delete clone.generatedAt;
  return clone;
};

const expectedJson = JSON.parse(await fs.readFile(path.join(root, 'docs', 'tooling', 'script-inventory.json'), 'utf8'));
const actualJson = JSON.parse(await fs.readFile(outputJsonPath, 'utf8'));
assert.deepStrictEqual(stripGeneratedAt(actualJson), stripGeneratedAt(expectedJson), 'script inventory json out of sync');

const normalizeMd = (text) => text.replace(/\r\n/g, '\n');
const expectedMd = normalizeMd(await fs.readFile(path.join(root, 'docs', 'guides', 'commands.md'), 'utf8'));
const actualMd = normalizeMd(await fs.readFile(outputMdPath, 'utf8'));
assert.strictEqual(actualMd, expectedMd, 'commands.md out of sync with script inventory generator');

console.log('script inventory sync test passed');
