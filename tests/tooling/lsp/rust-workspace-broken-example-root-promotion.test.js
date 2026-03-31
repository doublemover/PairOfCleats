#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildSelectedRustWorkspacePartitions } from '../../../src/index/tooling/rust-workspace-partitioning.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `rust-workspace-broken-example-promotion-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'examples', 'broken', 'src'), { recursive: true });

await fs.writeFile(
  path.join(tempRoot, 'Cargo.toml'),
  [
    '[workspace]',
    'members = ["examples/broken"]'
  ].join('\n'),
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'examples', 'broken', 'Cargo.toml'),
  '[package\nname = "broken-example"\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'examples', 'broken', 'src', 'main.rs'),
  'pub fn add(a: i32, b: i32) -> i32 { a + b }\n',
  'utf8'
);

const result = buildSelectedRustWorkspacePartitions(tempRoot, [
  '.poc-vfs/examples/broken/src/main.rs#seg:rust-workspace-broken-example-promotion.txt'
]);

assert.deepEqual(result.unmatchedPaths, [], 'expected broken example member document to match a promoted workspace partition');
assert.equal(result.partitions.length, 1, 'expected single promoted workspace partition');
assert.equal(result.partitions[0]?.rootRel, '.', 'expected broken example member to promote to ancestor workspace root');
assert.equal(result.partitions[0]?.role, 'workspace_root', 'expected promoted broken example partition role to be workspace_root');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('rust workspace broken example root promotion test passed');
