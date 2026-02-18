#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFileScanner } from '../../../src/index/build/file-scan.js';

const scanner = createFileScanner();

let swiftReads = 0;
const swiftResult = await scanner.scanFile({
  absPath: '/repo/Sources/NIOCore/ByteBuffer.swift',
  stat: { size: 2048 },
  ext: '.swift',
  readSample: async () => {
    swiftReads += 1;
    return Buffer.from('public struct ByteBuffer {}\n', 'utf8');
  }
});

assert.equal(swiftReads, 0, 'expected known text extension to bypass binary sampling');
assert.equal(swiftResult.skip, null, 'expected no skip for known text extension probe bypass');

let unknownReads = 0;
await scanner.scanFile({
  absPath: '/repo/blob.unknown',
  stat: { size: 2048 },
  ext: '.unknown',
  readSample: async () => {
    unknownReads += 1;
    return Buffer.from('not-binary\n', 'utf8');
  }
});

assert.ok(unknownReads > 0, 'expected unknown extension to continue binary sampling');

console.log('file-scan text fastpath test passed');
