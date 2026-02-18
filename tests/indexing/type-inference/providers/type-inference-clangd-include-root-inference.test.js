#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  extractIncludeHeadersFromDocuments,
  inferIncludeRootsFromHeaderPaths
} from '../../../../src/index/tooling/clangd-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'clangd-include-root-inference');
const repoRoot = path.join(tempRoot, 'repo');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'third_party', 'doctest'), { recursive: true });
await fs.mkdir(path.join(repoRoot, 'include'), { recursive: true });
await fs.mkdir(path.join(repoRoot, 'tests'), { recursive: true });

const documents = [
  {
    text: [
      '#include "doctest/doctest.h"',
      '#include <fmt/format.h>',
      '#include "doctest_compatibility.h"',
      '#include "doctest/doctest.h"'
    ].join('\n')
  }
];
const includeHeaders = extractIncludeHeadersFromDocuments(documents);

assert.deepEqual(
  includeHeaders,
  ['doctest/doctest.h', 'fmt/format.h', 'doctest_compatibility.h'],
  'expected include extraction to preserve first-seen order and de-duplicate entries'
);

const roots = inferIncludeRootsFromHeaderPaths({
  repoRoot,
  includeHeaders,
  headerPaths: [
    'third_party/doctest/doctest/doctest.h',
    'include/fmt/format.h',
    'tests/doctest_compatibility.h',
    'README.md'
  ],
  maxRoots: 10
});

assert.deepEqual(
  roots.map((entry) => path.relative(repoRoot, entry).replace(/\\/g, '/')).sort(),
  ['include', 'tests', 'third_party/doctest'],
  'expected include root inference to derive prefix roots from tracked header locations'
);

const limited = inferIncludeRootsFromHeaderPaths({
  repoRoot,
  includeHeaders,
  headerPaths: [
    'third_party/doctest/doctest/doctest.h',
    'include/fmt/format.h',
    'tests/doctest_compatibility.h'
  ],
  maxRoots: 2
});

assert.equal(limited.length, 2, 'expected maxRoots limit to be enforced');

console.log('clangd include root inference test passed');
