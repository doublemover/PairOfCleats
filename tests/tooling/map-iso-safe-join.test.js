#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { safeJoinUnderBase } from '../../tools/analysis/map-iso-safe-join.js';

const posixBase = '/srv/maps';
assert.equal(
  safeJoinUnderBase(posixBase, 'assets/isomap/scene.json', path.posix),
  '/srv/maps/assets/isomap/scene.json',
  'expected in-base posix path to resolve'
);
assert.equal(
  safeJoinUnderBase(posixBase, '../maps-escape/secret.json', path.posix),
  null,
  'expected posix traversal escape to be rejected'
);

const winBase = 'C:\\maps';
assert.equal(
  safeJoinUnderBase(winBase, 'assets\\isomap\\scene.json', path.win32),
  'C:\\maps\\assets\\isomap\\scene.json',
  'expected in-base win32 path to resolve'
);
assert.equal(
  safeJoinUnderBase(winBase, '..\\maps-escape\\secret.json', path.win32),
  null,
  'expected win32 sibling-prefix escape to be rejected'
);

console.log('map-iso safe join test passed');
