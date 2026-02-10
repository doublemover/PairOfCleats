#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFileRangeSync } from '../../../src/shared/files.js';

const originalOpenSync = fs.openSync;
const originalReadSync = fs.readSync;
const originalCloseSync = fs.closeSync;

let closedFd = null;
fs.openSync = () => 0;
fs.readSync = (_fd, buffer, _offset, _length, _position) => {
  buffer[0] = 65;
  buffer[1] = 66;
  return 2;
};
fs.closeSync = (fd) => {
  closedFd = fd;
};

try {
  const out = readFileRangeSync('ignored', 0, 2);
  assert.equal(out.toString('utf8'), 'AB');
  assert.equal(closedFd, 0, 'expected fd=0 to be closed');
} finally {
  fs.openSync = originalOpenSync;
  fs.readSync = originalReadSync;
  fs.closeSync = originalCloseSync;
}

console.log('read file range fd zero guard test passed');
