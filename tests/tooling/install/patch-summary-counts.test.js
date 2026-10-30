#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyPatches } from '../../../tools/setup/apply-patches.js';
import { createPatchFixture, originalText } from './patch-fixture.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'patch-summary-counts');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  const fixture = await createPatchFixture(root);
  await fs.writeFile(path.join(path.dirname(fixture.target), 'second.txt'), originalText);
  await fs.writeFile(fixture.patchFile, fixture.patch + fixture.patch.replaceAll('source.txt', 'second.txt'));
  const lines = [];
  assert.equal(applyPatches(root, { log: line => lines.push(line) }), 2);
  assert.equal(lines.filter(line => line.includes('sample+')).length, 1);
  assert.match(lines[0], /2 applied files, 0 already-applied files, 2 hunks/);
  assert.match(lines[1], /1 packages, 2 target files, 2 hunks; 2 files changed/);
  lines.length = 0;
  assert.equal(applyPatches(root, { verifyOnly: true, log: line => lines.push(line) }), 2);
  assert.match(lines[0], /verified; 0 applied files, 2 already-applied files, 2 hunks/);
  assert.match(lines[1], /verify-only:.*0 files changed/);
  lines.length = 0;
  applyPatches(root, { verbose: true, log: line => lines.push(line) });
  assert.equal(lines.filter(line => line.includes('node_modules/sample/')).length, 2);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Package patch summaries preserve file/hunk counts.');
