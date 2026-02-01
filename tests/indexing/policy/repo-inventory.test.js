#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../../helpers/root.js';

const root = repoRoot();
const inventoryPath = path.join(root, 'docs', 'tooling', 'repo-inventory.json');

const fail = (message) => {
  console.error(`repo inventory policy failed: ${message}`);
  process.exit(1);
};

const expectArray = (value, label) => {
  if (!Array.isArray(value)) fail(`${label} is not an array`);
  for (const entry of value) {
    if (typeof entry !== 'string') fail(`${label} contains non-string entries`);
  }
};

let raw;
try {
  raw = await fsPromises.readFile(inventoryPath, 'utf8');
} catch (error) {
  fail(error?.message || String(error));
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (error) {
  fail(`invalid json: ${error?.message || error}`);
}

if (typeof payload.generatedAt !== 'string') fail('generatedAt missing');
if (!payload.docs || typeof payload.docs !== 'object') fail('docs section missing');
if (!payload.tools || typeof payload.tools !== 'object') fail('tools section missing');
if (!payload.scripts || typeof payload.scripts !== 'object') fail('scripts section missing');

expectArray(payload.docs.files, 'docs.files');
expectArray(payload.docs.referenced, 'docs.referenced');
expectArray(payload.docs.orphans, 'docs.orphans');

expectArray(payload.tools.entrypoints, 'tools.entrypoints');
expectArray(payload.tools.referenced, 'tools.referenced');
expectArray(payload.tools.orphans, 'tools.orphans');

expectArray(payload.scripts.all, 'scripts.all');
expectArray(payload.scripts.referenced, 'scripts.referenced');
expectArray(payload.scripts.orphans, 'scripts.orphans');

console.log('repo inventory policy test passed');
