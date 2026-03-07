#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { readJsonFileSafe, readJsonFileSyncSafe } from '../../../src/shared/files.js';

const originalStatSync = fs.statSync;
const originalReadFileSync = fs.readFileSync;
const originalStat = fsPromises.stat;
const originalReadFile = fsPromises.readFile;

try {
  const syncErrors = [];
  fs.statSync = () => ({ size: 10 });
  fs.readFileSync = () => '{broken';
  const syncFallback = { ok: false };
  const syncOut = readJsonFileSyncSafe('sync.json', {
    fallback: syncFallback,
    maxBytes: 1024,
    onError: (info) => syncErrors.push(info)
  });
  assert.equal(syncOut, syncFallback);
  assert.equal(syncErrors.length, 1, 'expected exactly one sync parse error');
  assert.equal(syncErrors[0]?.phase, 'parse');
  assert.equal(syncErrors[0]?.sync, true);
  assert.equal(syncErrors[0]?.path, 'sync.json');

  const asyncErrors = [];
  fsPromises.stat = async () => ({ size: 10 });
  fsPromises.readFile = async () => '{oops';
  const asyncFallback = { ok: false };
  const asyncOut = await readJsonFileSafe('async.json', {
    fallback: asyncFallback,
    maxBytes: 1024,
    onError: (info) => asyncErrors.push(info)
  });
  assert.equal(asyncOut, asyncFallback);
  assert.equal(asyncErrors.length, 1, 'expected exactly one async parse error');
  assert.equal(asyncErrors[0]?.phase, 'parse');
  assert.equal(asyncErrors[0]?.sync, false);
  assert.equal(asyncErrors[0]?.path, 'async.json');
} finally {
  fs.statSync = originalStatSync;
  fs.readFileSync = originalReadFileSync;
  fsPromises.stat = originalStat;
  fsPromises.readFile = originalReadFile;
}

console.log('read json safe on-error test passed');
