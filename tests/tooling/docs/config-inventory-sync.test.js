#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const contractPath = path.join(root, 'docs', 'config', 'contract.md');

const text = await fs.readFile(contractPath, 'utf8');
assert.ok(text.includes('indexing.embeddings.cache.scope'), 'missing embeddings cache scope in contract');
assert.ok(text.includes('tooling.vfs'), 'missing tooling.vfs entries in contract');

console.log('config inventory sync test passed');
