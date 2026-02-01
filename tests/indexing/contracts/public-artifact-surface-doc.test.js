#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docPath = path.join(root, 'docs', 'contracts', 'public-artifact-surface.md');

const text = await fs.readFile(docPath, 'utf8');
assert.ok(text.includes('Public Artifact Surface'), 'missing doc title');
assert.ok(text.includes('artifactSurfaceVersion'), 'missing artifactSurfaceVersion section');
assert.ok(text.includes('Manifest-first discovery'), 'missing manifest-first discovery section');
assert.ok(text.includes('Sharded JSONL meta schema'), 'missing sharded meta schema section');
assert.ok(text.includes('Compatibility key'), 'missing compatibility key section');

console.log('public artifact surface doc test passed');
