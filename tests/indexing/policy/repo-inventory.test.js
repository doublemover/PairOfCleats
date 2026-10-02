#!/usr/bin/env node
import { buildRepoInventory } from '../../../tools/docs/repo-inventory.js';
import { repoRoot } from '../../helpers/root.js';

const root = repoRoot();

const fail = (message) => {
  console.error(`repo inventory policy failed: ${message}`);
  process.exit(1);
};

const expectArray = (value, label) => {
  if (!Array.isArray(value)) fail(`${label} is not an array`);
  for (const entry of value) {
    if (typeof entry !== 'string') fail(`${label} contains non-string entries`);
  }
};

let payload;
try {
  payload = await buildRepoInventory(root);
} catch (error) {
  fail(error?.message || String(error));
}

if (typeof payload.generatedAt !== 'string') fail('generatedAt missing');
if (!payload.docs || typeof payload.docs !== 'object') fail('docs section missing');
if (!payload.tools || typeof payload.tools !== 'object') fail('tools section missing');
if (!payload.scripts || typeof payload.scripts !== 'object') fail('scripts section missing');

expectArray(payload.docs.files, 'docs.files');
expectArray(payload.docs.referenced, 'docs.referenced');
expectArray(payload.docs.orphans, 'docs.orphans');

expectArray(payload.tools.entrypoints, 'tools.entrypoints');
expectArray(payload.tools.referenced, 'tools.referenced');
expectArray(payload.tools.orphans, 'tools.orphans');

expectArray(payload.scripts.all, 'scripts.all');
expectArray(payload.scripts.referenced, 'scripts.referenced');
expectArray(payload.scripts.orphans, 'scripts.orphans');

console.log('repo inventory policy test passed');
