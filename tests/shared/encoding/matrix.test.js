#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { readTextFileWithHash } from '../../../src/shared/encoding.js';
import { sha1 } from '../../../src/shared/hash.js';
import { truncateByBytes } from '../../../src/index/build/file-processor/read.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'encoding-matrix');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const cases = [
  {
    name: 'utf8-valid.txt',
    buffer: Buffer.from('hello café 😀', 'utf8'),
    expect: {
      usedFallback: false,
      encoding: 'utf8',
      encodingFallbackClass: null,
      encodingFallbackRisk: null,
      includes: 'café'
    }
  },
  {
    name: 'utf8-invalid.txt',
    buffer: Buffer.from([0xff, 0xfe, 0xfd, 0x41]),
    expect: {
      usedFallback: true,
      encodingFallbackClass: 'document',
      encodingFallbackRisk: 'low'
    }
  },
  {
    name: 'latin1.txt',
    buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
    expect: {
      usedFallback: true,
      encodingSet: new Set(['latin1', 'iso-8859-1', 'iso-8859-2', 'windows-1252']),
      text: 'café',
      encodingFallbackClass: 'document',
      encodingFallbackRisk: 'low'
    }
  },
  {
    name: 'windows-1252.txt',
    buffer: Buffer.from([0x93, 0x48, 0x69, 0x94]),
    expect: {
      usedFallback: true,
      encoding: 'windows-1252',
      text: '“Hi”',
      encodingFallbackClass: 'document',
      encodingFallbackRisk: 'low'
    }
  },
  {
    name: 'legacy-source.js',
    buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
    expect: {
      usedFallback: true,
      text: 'café',
      encodingFallbackClass: 'source',
      encodingFallbackRisk: 'high'
    }
  },
  {
    name: 'vendor-lib.js',
    dir: 'vendor',
    buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
    expect: {
      usedFallback: true,
      text: 'café',
      encodingFallbackClass: 'vendor',
      encodingFallbackRisk: 'low'
    }
  },
  {
    name: 'settings.yaml',
    buffer: Buffer.from([0xff, 0xfe, 0xfd, 0x41]),
    expect: {
      usedFallback: true,
      encodingFallbackClass: 'configuration',
      encodingFallbackRisk: 'medium'
    }
  }
];

for (const testCase of cases) {
  const filePath = testCase.dir
    ? path.join(tempRoot, testCase.dir, testCase.name)
    : path.join(tempRoot, testCase.name);
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, testCase.buffer);
  const info = await readTextFileWithHash(filePath);
  const expectedHash = sha1(testCase.buffer);
  if (info.hash !== expectedHash) {
    console.error(`Encoding matrix failed for ${testCase.name}: hash mismatch.`);
    process.exit(1);
  }
  if (info.usedFallback !== testCase.expect.usedFallback) {
    console.error(`Encoding matrix failed for ${testCase.name}: usedFallback mismatch.`);
    process.exit(1);
  }
  if (testCase.expect.encoding && info.encoding !== testCase.expect.encoding) {
    console.error(`Encoding matrix failed for ${testCase.name}: encoding ${info.encoding}.`);
    process.exit(1);
  }
  if (testCase.expect.encodingSet && !testCase.expect.encodingSet.has(info.encoding)) {
    console.error(`Encoding matrix failed for ${testCase.name}: encoding ${info.encoding}.`);
    process.exit(1);
  }
  if (testCase.expect.text && info.text !== testCase.expect.text) {
    console.error(`Encoding matrix failed for ${testCase.name}: text mismatch.`);
    process.exit(1);
  }
  if ((info.encodingFallbackClass || null) !== (testCase.expect.encodingFallbackClass || null)) {
    console.error(`Encoding matrix failed for ${testCase.name}: fallback class ${info.encodingFallbackClass}.`);
    process.exit(1);
  }
  if ((info.encodingFallbackRisk || null) !== (testCase.expect.encodingFallbackRisk || null)) {
    console.error(`Encoding matrix failed for ${testCase.name}: fallback risk ${info.encodingFallbackRisk}.`);
    process.exit(1);
  }
  if (testCase.expect.includes && !info.text.includes(testCase.expect.includes)) {
    console.error(`Encoding matrix failed for ${testCase.name}: missing text segment.`);
    process.exit(1);
  }
}

const emoji = '😀';
const sample = `start ${emoji} end`;
const limit = Buffer.byteLength('start ', 'utf8') + 2;
const truncated = truncateByBytes(sample, limit);
if (truncated.text.includes('\uFFFD')) {
  console.error('Encoding matrix failed: truncation split multi-byte sequence.');
  process.exit(1);
}
if (Buffer.byteLength(truncated.text, 'utf8') > limit) {
  console.error('Encoding matrix failed: truncation exceeded byte limit.');
  process.exit(1);
}

console.log('encoding matrix tests passed');

