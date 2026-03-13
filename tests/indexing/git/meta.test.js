#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getGitMeta } from '../../../src/index/git.js';

const root = process.cwd();
const target = path.join(root, 'README.md');

if (!fs.existsSync(target)) {
  console.error(`Missing README.md at ${target}`);
  process.exit(1);
}

const blameEnabled = await getGitMeta(target, 1, 1, { blame: true, baseDir: root });
const blameDisabled = await getGitMeta(target, 1, 1, { blame: false, baseDir: root });

if (blameDisabled.chunk_authors !== undefined) {
  console.error('Expected git blame metadata to be disabled, but chunk_authors is present.');
  process.exit(1);
}

if (blameEnabled.chunk_authors !== undefined && !Array.isArray(blameEnabled.chunk_authors)) {
  console.error('Expected chunk_authors to be an array when present.');
  process.exit(1);
}

console.log('Git metadata config test passed');
