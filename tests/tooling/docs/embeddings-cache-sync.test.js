#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docPath = path.join(root, 'docs', 'specs', 'embeddings-cache.md');

const text = await fs.readFile(docPath, 'utf8');
assert.ok(text.includes('# Embeddings Cache'), 'missing doc title');
assert.ok(text.includes('## Layout'), 'missing layout section');
assert.ok(/##\s+Cache entry format/i.test(text), 'missing cache entry format');
assert.ok(text.includes('## Invalidation'), 'missing invalidation section');
assert.ok(text.includes('## Pruning'), 'missing pruning section');
assert.ok(text.includes('## Configuration'), 'missing configuration section');

console.log('embeddings cache docs sync test passed');
