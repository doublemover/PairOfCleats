#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  decodeMapViewerPathname,
  resolveMapViewerPathUnderBase
} from '../../tools/bench/map/shared.js';

const posixBase = '/srv/bench/assets/isomap';
assert.equal(
  resolveMapViewerPathUnderBase(posixBase, 'textures/grid.png', path.posix),
  '/srv/bench/assets/isomap/textures/grid.png',
  'expected in-base posix path to resolve'
);
assert.equal(
  resolveMapViewerPathUnderBase(posixBase, '../isomap-escape/secret.png', path.posix),
  null,
  'expected posix sibling-prefix escape to be rejected'
);

const winBase = 'C:\\bench\\assets\\isomap';
assert.equal(
  resolveMapViewerPathUnderBase(winBase, 'textures\\grid.png', path.win32),
  'C:\\bench\\assets\\isomap\\textures\\grid.png',
  'expected in-base win32 path to resolve'
);
assert.equal(
  resolveMapViewerPathUnderBase(winBase, '..\\isomap-escape\\secret.png', path.win32),
  null,
  'expected win32 sibling-prefix escape to be rejected'
);
assert.equal(
  decodeMapViewerPathname('/assets/isomap/scene.png'),
  '/assets/isomap/scene.png',
  'expected valid map viewer pathname decoding'
);
assert.equal(
  decodeMapViewerPathname('/%E0%A4%A'),
  null,
  'expected malformed map viewer pathname encoding to be rejected'
);

console.log('map bench safe join test passed');
