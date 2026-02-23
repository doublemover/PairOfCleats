#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { preprocessFiles } from '../../../src/index/build/preprocess.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-preprocess-prefilter-'));
try {
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'plain.txt'), 'just plain prose without markers\n');
  await fs.writeFile(path.join(tempRoot, 'docs', 'frontmatter.md'), '---\ntitle: Demo\n---\nBody\n');
  await fs.writeFile(path.join(tempRoot, 'src', 'app.js'), '// comment\nconst x = 1;\n');

  const result = await preprocessFiles({
    root: tempRoot,
    modes: ['extracted-prose'],
    ignoreMatcher: { ignores: () => false },
    lineCounts: false,
    concurrency: 4
  });

  const extractedEntries = result.entriesByMode['extracted-prose'] || [];
  const rels = new Set(extractedEntries.map((entry) => String(entry.rel || '').replace(/\\/g, '/')));

  assert.equal(rels.has('docs/plain.txt'), false, 'expected plain prose without markers to be prefiltered');
  assert.equal(rels.has('docs/frontmatter.md'), true, 'expected markdown frontmatter file to remain');
  assert.equal(rels.has('src/app.js'), true, 'expected code file to remain in extracted-prose');

  console.log('extracted-prose candidate prefilter test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
