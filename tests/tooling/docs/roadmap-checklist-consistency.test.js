#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docPath = path.join(root, 'docs', 'guides', 'roadmap-checklists.md');

const text = await fs.readFile(docPath, 'utf8');
assert.ok(text.includes('# Roadmap Checklist Rules'), 'missing title');
assert.ok(text.includes('## Checklist update rules'), 'missing checklist rules section');
assert.ok(text.includes('## Recommended checklist format'), 'missing checklist format section');

console.log('roadmap checklist consistency test passed');
