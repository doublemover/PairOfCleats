#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { decodePathnameSafe, safeJoinUnderBase } from '../../tools/analysis/map-iso-safe-join.js';

const passthroughFs = { realpathSync: (targetPath) => targetPath };

const posixBase = '/srv/maps';
assert.equal(
  safeJoinUnderBase(posixBase, 'assets/isomap/scene.json', path.posix, passthroughFs),
  '/srv/maps/assets/isomap/scene.json',
  'expected in-base posix path to resolve'
);
assert.equal(
  safeJoinUnderBase(posixBase, '..assets/isomap/scene.json', path.posix, passthroughFs),
  '/srv/maps/..assets/isomap/scene.json',
  'expected in-base dotdot-prefixed segment to resolve'
);
assert.equal(
  safeJoinUnderBase(posixBase, '../maps-escape/secret.json', path.posix, passthroughFs),
  null,
  'expected posix traversal escape to be rejected'
);
assert.equal(
  safeJoinUnderBase(
    posixBase,
    'assets/isomap-link/scene.json',
    path.posix,
    {
      realpathSync: (targetPath) => {
        if (targetPath === '/srv/maps') return '/srv/maps';
        if (targetPath === '/srv/maps/assets/isomap-link/scene.json') return '/etc/scene.json';
        return targetPath;
      }
    }
  ),
  null,
  'expected symlink escape target to be rejected'
);

const winBase = 'C:\\maps';
assert.equal(
  safeJoinUnderBase(winBase, 'assets\\isomap\\scene.json', path.win32, passthroughFs),
  'C:\\maps\\assets\\isomap\\scene.json',
  'expected in-base win32 path to resolve'
);
assert.equal(
  safeJoinUnderBase(winBase, '..assets\\isomap\\scene.json', path.win32, passthroughFs),
  'C:\\maps\\..assets\\isomap\\scene.json',
  'expected in-base dotdot-prefixed win32 segment to resolve'
);
assert.equal(
  safeJoinUnderBase(winBase, '..\\maps-escape\\secret.json', path.win32, passthroughFs),
  null,
  'expected win32 sibling-prefix escape to be rejected'
);
assert.equal(
  decodePathnameSafe('/assets/isomap/scene.json'),
  '/assets/isomap/scene.json',
  'expected valid pathname decoding'
);
assert.equal(
  decodePathnameSafe('/%E0%A4%A'),
  null,
  'expected malformed pathname encoding to be rejected'
);

console.log('map-iso safe join test passed');
