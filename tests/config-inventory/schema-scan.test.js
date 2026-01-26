#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectSchemaEntries, getLeafEntries } from '../../tools/config-inventory.js';

const root = process.cwd();
const schemaPath = path.join(root, 'docs', 'config-schema.json');
const schemaRaw = await fs.readFile(schemaPath, 'utf8');
const schema = JSON.parse(schemaRaw);

const entries = collectSchemaEntries(schema);
assert.ok(entries.length > 0, 'expected schema entries to be discovered');
assert.ok(
  entries.some((entry) => entry.path === 'cache.root'),
  'expected cache.root to be present in schema entries'
);

const leaves = getLeafEntries(entries);
assert.ok(leaves.length > 0, 'expected leaf entries to be discovered');

console.log('config-inventory schema scan test passed');
