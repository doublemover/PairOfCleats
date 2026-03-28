#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';

const withRepo = (prefix, build) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return build(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
};

const buildPack = ({
  repoRoot,
  seed,
  chunkMeta,
  indexSignature = 'test',
  maxTokens,
  maxBytes
}) => assembleCompositeContextPack({
  seed,
  chunkMeta,
  repoRoot,
  indexSignature,
  maxTokens,
  maxBytes,
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  includePaths: false,
  depth: 0
});

const cases = [
  {
    name: 'index signature invalidates excerpt cache',
    run() {
      return withRepo('context-pack-excerpt-cache-', (repoRoot) => {
        const srcDir = path.join(repoRoot, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        const filePath = path.join(srcDir, 'gamma.txt');
        fs.writeFileSync(filePath, 'alpha beta gamma');
        const chunkMeta = [
          { chunkUid: 'chunk-g', file: 'src/gamma.txt', start: 0, end: 18 }
        ];
        const first = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-g' },
          chunkMeta,
          indexSignature: 'test',
          maxTokens: 2
        });
        fs.writeFileSync(filePath, 'delta epsilon zeta');
        const second = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-g' },
          chunkMeta,
          indexSignature: 'test',
          maxTokens: 2
        });
        const third = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-g' },
          chunkMeta,
          indexSignature: 'test-updated',
          maxTokens: 2
        });
        assert.equal(second.primary.excerpt, first.primary.excerpt);
        assert.equal(third.primary.excerpt, 'delta epsilon');
      });
    }
  },
  {
    name: 'excerpt and hash remain stable for duplicate reads',
    run() {
      return withRepo('context-pack-dedupe-', (repoRoot) => {
        const srcDir = path.join(repoRoot, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'alpha.txt'), 'same excerpt content');
        const chunkMeta = [
          { chunkUid: 'chunk-a', file: 'src/alpha.txt', start: 0, end: 10 }
        ];
        const first = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-a' },
          chunkMeta
        });
        const second = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-a' },
          chunkMeta
        });
        assert.equal(second.primary.excerpt, first.primary.excerpt);
        assert.equal(second.primary.excerptHash, first.primary.excerptHash);
      });
    }
  },
  {
    name: 'file cache varies by maxTokens without rereading wrong content',
    run() {
      return withRepo('context-pack-file-cache-', (repoRoot) => {
        const srcDir = path.join(repoRoot, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        const filePath = path.join(srcDir, 'delta.txt');
        fs.writeFileSync(filePath, 'alpha beta gamma');
        const chunkMeta = [
          { chunkUid: 'chunk-d', file: 'src/delta.txt', start: 0, end: 18 }
        ];
        const first = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-d' },
          chunkMeta,
          maxTokens: 2
        });
        fs.writeFileSync(filePath, 'delta epsilon zeta');
        const second = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-d' },
          chunkMeta,
          maxTokens: 1
        });
        assert.equal(first.primary.excerpt, 'alpha beta');
        assert.equal(second.primary.excerpt, 'alpha');
      });
    }
  },
  {
    name: 'range excerpts honor chunk boundaries',
    run() {
      return withRepo('context-pack-range-', (repoRoot) => {
        const srcDir = path.join(repoRoot, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'alpha.txt'), '0123456789');
        const payload = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-a' },
          chunkMeta: [
            { chunkUid: 'chunk-a', file: 'src/alpha.txt', start: 2, end: 8 }
          ]
        });
        assert.equal(payload.primary.excerpt, '234567');
      });
    }
  },
  {
    name: 'range reads honor maxBytes truncation',
    run() {
      return withRepo('context-pack-range-reads-', (repoRoot) => {
        const srcDir = path.join(repoRoot, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'beta.txt'), 'abcdefghijklmnopqrstuvwxyz');
        const payload = buildPack({
          repoRoot,
          seed: { type: 'chunk', chunkUid: 'chunk-b' },
          chunkMeta: [
            { chunkUid: 'chunk-b', file: 'src/beta.txt', start: 5, end: 20 }
          ],
          maxBytes: 4
        });
        assert.equal(payload.primary.excerpt, 'fghi');
      });
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('context pack excerpt contract matrix test passed');
