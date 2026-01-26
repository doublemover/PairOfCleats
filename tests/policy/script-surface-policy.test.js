#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../helpers/root.js';

const root = repoRoot();
const inventoryPath = path.join(root, 'docs', 'tooling', 'script-inventory.json');
const pkgPath = path.join(root, 'package.json');

const pkg = JSON.parse(await fsPromises.readFile(pkgPath, 'utf8'));
const scripts = pkg.scripts || {};

let inventory;
try {
  inventory = JSON.parse(await fsPromises.readFile(inventoryPath, 'utf8'));
} catch {
  console.error('script surface policy failed: missing docs/tooling/script-inventory.json');
  process.exit(1);
}

const inventoryNames = new Set((inventory.scripts || []).map((entry) => entry.name));
const packageNames = new Set(Object.keys(scripts));

const missing = Array.from(packageNames).filter((name) => !inventoryNames.has(name));
const extra = Array.from(inventoryNames).filter((name) => !packageNames.has(name));

if (missing.length || extra.length) {
  console.error('script surface policy failed: inventory out of date');
  if (missing.length) console.error(`Missing in inventory: ${missing.sort().join(', ')}`);
  if (extra.length) console.error(`Extra in inventory: ${extra.sort().join(', ')}`);
  process.exit(1);
}

console.log('script surface policy test passed');

