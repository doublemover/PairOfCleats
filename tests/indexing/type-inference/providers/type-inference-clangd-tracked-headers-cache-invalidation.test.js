#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  normalizeTrackedHeaders,
  prepareTrackedHeaderRepo
} from './tracked-headers-fixture.js';

const { repoRoot, runGit } = await prepareTrackedHeaderRepo('clangd-tracked-headers-cache-invalidation');
const first = normalizeTrackedHeaders(repoRoot);
assert.ok(first.includes('include/a.h'), 'expected first scan to include a.h');
assert.ok(!first.includes('include/b.h'), 'did not expect first scan to include b.h');

await fs.writeFile(path.join(repoRoot, 'include', 'b.h'), '#pragma once\n');
await new Promise((resolve) => setTimeout(resolve, 25));
runGit(['add', 'include/b.h']);

const second = normalizeTrackedHeaders(repoRoot);
assert.ok(second.includes('include/a.h'), 'expected cache refresh to retain a.h');
assert.ok(second.includes('include/b.h'), 'expected cache refresh to include newly added b.h');

console.log('clangd tracked headers cache invalidation test passed');
