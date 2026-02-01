#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../../helpers/root.js';

const root = repoRoot();
const pkgPath = path.join(root, 'package.json');
const inventoryPath = path.join(root, 'docs', 'tooling', 'script-inventory.json');

const stableEntrypoints = [
  'lint',
  'format',
  'config:budget',
  'env:check'
];

const fail = (message) => {
  console.error(`stable entrypoints test failed: ${message}`);
  process.exit(1);
};

let pkg;
let inventory;
try {
  const [pkgRaw, inventoryRaw] = await Promise.all([
    fsPromises.readFile(pkgPath, 'utf8'),
    fsPromises.readFile(inventoryPath, 'utf8')
  ]);
  pkg = JSON.parse(pkgRaw);
  inventory = JSON.parse(inventoryRaw);
} catch (error) {
  fail(error?.message || String(error));
}

const scripts = pkg.scripts || {};
const inventoryNames = new Set((inventory.scripts || []).map((entry) => entry.name));

const missingInPackage = stableEntrypoints.filter((name) => !scripts[name]);
if (missingInPackage.length) {
  fail(`missing in package.json: ${missingInPackage.join(', ')}`);
}

const missingInInventory = stableEntrypoints.filter((name) => !inventoryNames.has(name));
if (missingInInventory.length) {
  fail(`missing in docs/tooling/script-inventory.json: ${missingInInventory.join(', ')}`);
}

console.log('stable entrypoints test passed');
