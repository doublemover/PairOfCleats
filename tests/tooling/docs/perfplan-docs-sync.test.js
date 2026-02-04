#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const planPath = path.join(root, 'PERFPLAN.MD');

const text = await fs.readFile(planPath, 'utf8');
assert.ok(text.includes('Phase 13'), 'missing Phase 13 section');
assert.ok(text.includes('Documentation + JSDoc'), 'missing Phase 13 title');
assert.ok(text.includes('docs/guides/jsdoc-standards.md'), 'missing jsdoc standards doc reference');
assert.ok(text.includes('docs/guides/perfplan-execution.md'), 'missing perfplan execution guide reference');
assert.ok(text.includes('docs/guides/roadmap-checklists.md'), 'missing roadmap checklist guide reference');

console.log('perfplan docs sync test passed');
