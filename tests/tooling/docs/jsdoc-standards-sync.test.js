#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docPath = path.join(root, 'docs', 'guides', 'jsdoc-standards.md');

const text = await fs.readFile(docPath, 'utf8');
assert.ok(text.includes('# JSDoc Standards'), 'missing title');
assert.ok(text.includes('## Required sections'), 'missing required sections');
assert.ok(text.includes('Performance'), 'missing performance guidance');
assert.ok(text.includes('## Examples'), 'missing examples section');

console.log('jsdoc standards sync test passed');
