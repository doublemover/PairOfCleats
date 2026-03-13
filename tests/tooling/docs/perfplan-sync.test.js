#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const guidePath = path.join(root, 'docs', 'guides', 'perfplan-execution.md');

const text = await fs.readFile(guidePath, 'utf8');
assert.ok(text.includes('# PERFPLAN Execution Guide'), 'missing perfplan guide title');
assert.ok(/ROADMAP\.md|roadmap/i.test(text), 'missing roadmap reference');
assert.ok(text.includes('docs/guides/roadmap-checklists.md'), 'missing roadmap checklist guide reference');
assert.ok(text.includes('docs/guides/jsdoc-standards.md'), 'missing jsdoc standards doc reference');

console.log('perfplan docs sync test passed');
