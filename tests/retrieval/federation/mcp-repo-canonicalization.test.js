#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearRepoCaches, getRepoCaches } from '../../../tools/mcp/repo.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-mcp-repo-canon-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const nested = path.join(repoRoot, 'src', 'nested');

await fs.mkdir(nested, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const rootEntry = getRepoCaches(repoRoot);
const nestedEntry = getRepoCaches(nested);

assert.equal(rootEntry, nestedEntry, 'MCP repo caches should key subdir paths to canonical repo root');

clearRepoCaches(repoRoot);

console.log('MCP repo canonicalization test passed');
