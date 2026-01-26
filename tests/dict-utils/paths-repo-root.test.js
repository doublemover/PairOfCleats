#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveRepoRoot } from '../../tools/dict-utils/paths.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-dict-root-'));
const nested = path.join(tempRoot, 'a', 'b');
await fs.writeFile(path.join(tempRoot, '.pairofcleats.json'), '{}');
await fs.mkdir(nested, { recursive: true });

const resolved = resolveRepoRoot(nested);
assert.equal(resolved, path.resolve(tempRoot));

console.log('dict-utils resolveRepoRoot test passed');
