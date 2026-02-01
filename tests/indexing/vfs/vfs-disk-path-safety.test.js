#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';

const root = process.cwd();
const baseDir = path.join(root, '.testCache', 'vfs-disk-path-safety');

const unsafeVirtualPath = '.poc-vfs/src/illegal:chars*?.ts#seg:segu:v1:abc.ts';
const resolvedUnsafe = resolveVfsDiskPath({ baseDir, virtualPath: unsafeVirtualPath });
assert.ok(resolvedUnsafe.includes('%3A'), 'colon should be percent-encoded in disk path');
assert.ok(resolvedUnsafe.includes('%2A'), 'asterisk should be percent-encoded in disk path');
assert.ok(resolvedUnsafe.includes('%3F'), 'question mark should be percent-encoded in disk path');

const traversalVirtualPath = '.poc-vfs/../escape.txt';
const resolvedTraversal = resolveVfsDiskPath({ baseDir, virtualPath: traversalVirtualPath });
const resolvedBase = path.resolve(baseDir);
const resolvedTarget = path.resolve(resolvedTraversal);
assert.ok(
  resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`),
  'resolved disk path should stay under baseDir'
);
assert.ok(
  resolvedTraversal.includes('%2E%2E'),
  'dot-dot path segments should be encoded as literal components'
);

console.log('VFS disk path safety ok');
