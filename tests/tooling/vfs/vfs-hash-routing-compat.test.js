#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildVfsHashVirtualPath,
  buildVfsVirtualPath,
  resolveVfsVirtualPath
} from '../../../src/index/tooling/vfs.js';

const containerPath = 'src/app.ts';
const segmentUid = 'segu:v1:abc';
const effectiveExt = '.ts';

const legacy = buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt });
const fallback = resolveVfsVirtualPath({
  containerPath,
  segmentUid,
  effectiveExt,
  docHash: null,
  hashRouting: true
});
assert.equal(fallback, legacy, 'Expected hash routing to fall back to legacy path when docHash is missing.');

const docHash = 'xxh64:0123456789abcdef';
const hashPath = buildVfsHashVirtualPath({ docHash, effectiveExt });
assert.ok(hashPath && hashPath.startsWith('.poc-vfs/by-hash/'), 'Expected hash virtual path prefix.');

const resolved = resolveVfsVirtualPath({
  containerPath,
  segmentUid,
  effectiveExt,
  docHash,
  hashRouting: true
});
assert.equal(resolved, hashPath, 'Expected hash routing to return hash virtual path.');

console.log('vfs hash routing compat ok');
