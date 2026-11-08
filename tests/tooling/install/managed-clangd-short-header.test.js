import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasClangdTargetHeader } from '../../../src/shared/managed-clangd.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clangd-header-'));
try {
  const fixtures = [];
  const elf = Buffer.alloc(64); Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf); elf.writeUInt16LE(0x3e, 18);
  fixtures.push({ platform: 'linux', arch: 'x64', bytes: elf });
  const pe = Buffer.alloc(128); pe.writeUInt16LE(0x5a4d); pe.writeUInt32LE(64, 0x3c); pe.writeUInt32LE(0x4550, 64); pe.writeUInt16LE(0x8664, 68);
  fixtures.push({ platform: 'win32', arch: 'x64', bytes: pe });
  const mach = Buffer.alloc(32); mach.writeUInt32BE(0xfeedfacf); mach.writeUInt32BE(0x0100000c, 4);
  fixtures.push({ platform: 'darwin', arch: 'arm64', bytes: mach });
  const original = fs.readSync;
  for (const [index, fixture] of fixtures.entries()) {
    const file = path.join(root, `${index}.bin`); fs.writeFileSync(file, fixture.bytes);
    assert.equal(hasClangdTargetHeader(file, fixture), true);
    fs.readSync = (fd, buffer, offset, length, position) => original(fd, buffer, offset, Math.min(3, length), position);
    try { assert.equal(hasClangdTargetHeader(file, fixture), true); }
    finally { fs.readSync = original; }
    fs.writeFileSync(file, fixture.bytes.subarray(0, 7));
    assert.equal(hasClangdTargetHeader(file, fixture), false);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Managed binary headers tolerate positive short reads across formats.');
