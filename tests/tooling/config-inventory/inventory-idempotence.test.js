#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildInventory } from '../../../tools/config/inventory.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'config-inventory-idempotence');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outputJsonPath = path.join(tempRoot, 'inventory.json');
const outputMdPath = path.join(tempRoot, 'inventory.md');
const schemaPath = path.join(root, 'docs', 'config', 'schema.json');

await buildInventory({
  root,
  schemaPath,
  outputJsonPath,
  outputMdPath,
  check: false
});

const firstJsonText = await fs.readFile(outputJsonPath, 'utf8');
const firstMdText = await fs.readFile(outputMdPath, 'utf8');
const firstJson = JSON.parse(firstJsonText);

await new Promise((resolve) => setTimeout(resolve, 20));

await buildInventory({
  root,
  schemaPath,
  outputJsonPath,
  outputMdPath,
  check: false
});

const secondJsonText = await fs.readFile(outputJsonPath, 'utf8');
const secondMdText = await fs.readFile(outputMdPath, 'utf8');
const secondJson = JSON.parse(secondJsonText);

assert.equal(secondJson.generatedAt, firstJson.generatedAt, 'expected generatedAt to be preserved when inventory content is unchanged');
assert.equal(secondJsonText, firstJsonText, 'expected inventory json output to be byte-stable across identical reruns');
assert.equal(secondMdText, firstMdText, 'expected inventory markdown output to be byte-stable across identical reruns');

console.log('config inventory idempotence test passed');
