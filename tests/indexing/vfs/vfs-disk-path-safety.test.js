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
assert.throws(
  () => resolveVfsDiskPath({ baseDir, virtualPath: traversalVirtualPath }),
  /must not escape the baseDir/i
);

console.log('VFS disk path safety ok');
