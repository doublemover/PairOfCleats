#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { truncateByBytes } from '../../../src/index/build/file-processor/read.js';
import { buildFileMeta } from '../../../src/index/build/artifacts/file-meta.js';
import { reuseCachedBundle } from '../../../src/index/build/file-processor/cached-bundle.js';
import { readTextFileWithHash } from '../../../src/shared/encoding.js';
import { sha1 } from '../../../src/shared/hash.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'encoding-contract-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

{
  const filePath = path.join(tempRoot, 'hash-invalid.txt');
  const buffer = Buffer.from([0xff, 0xfe, 0xfd, 0x41]);
  await fs.writeFile(filePath, buffer);
  const info = await readTextFileWithHash(filePath);
  assert.equal(info.hash, sha1(buffer));
  assert.equal(info.usedFallback, true);
}

{
  const caseRoot = path.join(tempRoot, 'matrix');
  await fs.mkdir(caseRoot, { recursive: true });
  const cases = [
    {
      name: 'utf8-valid.txt',
      buffer: Buffer.from('hello café 😀', 'utf8'),
      expect: { usedFallback: false, encoding: 'utf8', encodingFallbackClass: null, encodingFallbackRisk: null, includes: 'café' }
    },
    {
      name: 'utf8-invalid.txt',
      buffer: Buffer.from([0xff, 0xfe, 0xfd, 0x41]),
      expect: { usedFallback: true, encodingFallbackClass: 'document', encodingFallbackRisk: 'low' }
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
      expect: { usedFallback: true, encoding: 'windows-1252', text: '“Hi”', encodingFallbackClass: 'document', encodingFallbackRisk: 'low' }
    },
    {
      name: 'legacy-source.js',
      buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
      expect: { usedFallback: true, text: 'café', encodingFallbackClass: 'source', encodingFallbackRisk: 'high' }
    },
    {
      name: 'vendor-lib.js',
      dir: 'vendor',
      buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
      expect: { usedFallback: true, text: 'café', encodingFallbackClass: 'vendor', encodingFallbackRisk: 'low' }
    },
    {
      name: 'settings.yaml',
      buffer: Buffer.from([0xff, 0xfe, 0xfd, 0x41]),
      expect: { usedFallback: true, encodingFallbackClass: 'configuration', encodingFallbackRisk: 'medium' }
    }
  ];

  for (const testCase of cases) {
    const filePath = testCase.dir ? path.join(caseRoot, testCase.dir, testCase.name) : path.join(caseRoot, testCase.name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, testCase.buffer);
    const info = await readTextFileWithHash(filePath);
    assert.equal(info.hash, sha1(testCase.buffer), testCase.name);
    assert.equal(info.usedFallback, testCase.expect.usedFallback, `${testCase.name} usedFallback`);
    if (testCase.expect.encoding) {
      assert.equal(info.encoding, testCase.expect.encoding, `${testCase.name} encoding`);
    }
    if (testCase.expect.encodingSet) {
      assert.ok(testCase.expect.encodingSet.has(info.encoding), `${testCase.name} encoding set`);
    }
    if (testCase.expect.text) {
      assert.equal(info.text, testCase.expect.text, `${testCase.name} text`);
    }
    assert.equal(info.encodingFallbackClass || null, testCase.expect.encodingFallbackClass || null, `${testCase.name} fallback class`);
    assert.equal(info.encodingFallbackRisk || null, testCase.expect.encodingFallbackRisk || null, `${testCase.name} fallback risk`);
    if (testCase.expect.includes) {
      assert.ok(info.text.includes(testCase.expect.includes), `${testCase.name} includes`);
    }
  }

  const emoji = '😀';
  const sample = `start ${emoji} end`;
  const limit = Buffer.byteLength('start ', 'utf8') + 2;
  const truncated = truncateByBytes(sample, limit);
  assert.ok(!truncated.text.includes('\uFFFD'));
  assert.ok(Buffer.byteLength(truncated.text, 'utf8') <= limit);
}

{
  const repoRoot = path.join(tempRoot, 'repo');
  await fs.mkdir(repoRoot, { recursive: true });
  const targetPath = path.join(repoRoot, 'encoded.txt');
  await fs.writeFile(targetPath, 'demo');
  const stat = await fs.stat(targetPath);

  const cachedBundle = {
    chunks: [
      {
        file: 'encoded.txt',
        ext: '.txt',
        start: 0,
        end: 4,
        startLine: 1,
        endLine: 1,
        kind: 'text',
        tokens: ['demo'],
        chunkUid: 'ck:encoded',
        virtualPath: 'encoded.txt'
      }
    ],
    fileRelations: {},
    encoding: 'windows-1252',
    encodingFallback: true,
    encodingFallbackClass: 'source',
    encodingFallbackRisk: 'high',
    encodingConfidence: 0.42
  };

  const { result, skip } = reuseCachedBundle({
    abs: targetPath,
    relKey: 'encoded.txt',
    fileIndex: 0,
    fileStat: stat,
    fileHash: 'hash',
    fileHashAlgo: 'sha1',
    ext: '.txt',
    fileCaps: {},
    cachedBundle,
    incrementalState: {
      manifest: {
        files: {
          'encoded.txt': {
            bundle: 'encoded.json',
            hash: 'hash',
            encoding: 'windows-1252',
            encodingFallback: true,
            encodingFallbackClass: 'source',
            encodingFallbackRisk: 'high',
            encodingConfidence: 0.42
          }
        }
      }
    },
    fileStructural: null,
    toolInfo: null,
    fileStart: Date.now(),
    knownLines: 1,
    fileLanguageId: null
  });

  assert.equal(skip, null);
  assert(result);
  assert.equal(result.fileInfo.encoding, 'windows-1252');
  assert.equal(result.fileInfo.encodingFallback, true);
  assert.equal(result.fileInfo.encodingFallbackClass, 'source');
  assert.equal(result.fileInfo.encodingFallbackRisk, 'high');
  assert.equal(result.fileInfo.encodingConfidence, 0.42);

  const { fileMeta } = buildFileMeta({
    chunks: result.chunks,
    fileInfoByPath: new Map([[result.relKey, result.fileInfo]])
  });
  const entry = fileMeta.find((item) => item.file === 'encoded.txt');
  assert(entry);
  assert.equal(entry.encoding, 'windows-1252');
  assert.equal(entry.encodingFallback, true);
  assert.equal(entry.encodingFallbackClass, 'source');
  assert.equal(entry.encodingFallbackRisk, 'high');
  assert.equal(entry.encodingConfidence, 0.42);
}

console.log('encoding contract matrix test passed');
