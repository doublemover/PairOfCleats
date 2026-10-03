#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyTestEnv } from '../helpers/test-env.js';
import { assembleCompositeContextPack, buildChunkIndex } from '../../src/context-pack/assemble.js';

const cases = [
  {
    name: 'file seeds normalize path separators before primary selection',
    run() {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-core-seed-'));
      const srcDir = path.join(repoRoot, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'alpha.js'), 'console.log("alpha");\n');

      const chunkMeta = [
        { chunkUid: 'chunk-alpha', file: 'src/alpha.js', start: 0, end: 10 }
      ];

      const payload = assembleCompositeContextPack({
        seed: { type: 'file', path: 'src\\alpha.js' },
        chunkMeta,
        repoRoot,
        indexSignature: 'test',
        includeGraph: false,
        includeTypes: false,
        includeRisk: false,
        includeImports: false,
        includeUsages: false,
        includeCallersCallees: false,
        includePaths: false,
        depth: 0
      });

      assert.equal(payload.primary.file, 'src/alpha.js');
    }
  },
  {
    name: 'prebuilt chunk indexes remain authoritative after source metadata mutation',
    run() {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-core-index-'));
      const srcDir = path.join(repoRoot, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a.js'), 'console.log("a");\n');

      const chunkMeta = [
        { chunkUid: 'chunk-a', file: 'src/a.js', start: 0, end: 5 }
      ];
      const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot });
      chunkMeta[0].file = 'src/other.js';

      const payload = assembleCompositeContextPack({
        seed: { type: 'file', path: 'src/a.js' },
        chunkMeta,
        chunkIndex,
        repoRoot,
        indexSignature: 'test',
        includeGraph: false,
        includeTypes: false,
        includeRisk: false,
        includeImports: false,
        includeUsages: false,
        includeCallersCallees: false,
        includePaths: false,
        depth: 0
      });

      assert.equal(payload.primary.file, 'src/a.js');
    }
  },
  {
    name: 'assembly records memory counters and excerpt bytes for direct chunk seeds',
    run() {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-core-memory-'));
      const srcDir = path.join(repoRoot, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'mem.js'), 'console.log("mem");');

      const chunkMeta = [
        { chunkUid: 'chunk-m', file: 'src/mem.js', start: 0, end: 10 }
      ];

      const payload = assembleCompositeContextPack({
        seed: { type: 'chunk', chunkUid: 'chunk-m' },
        chunkMeta,
        repoRoot,
        indexSignature: 'test',
        includeGraph: false,
        includeTypes: false,
        includeRisk: false,
        includeImports: false,
        includeUsages: false,
        includeCallersCallees: false,
        includePaths: false,
        depth: 0
      });

      assert.ok(payload.stats?.memory?.start);
      assert.ok(payload.stats?.memory?.end);
      assert.ok(payload.stats?.memory?.peak);
      assert.equal(payload.stats.excerptBytes, Buffer.byteLength(payload.primary.excerpt || '', 'utf8'));
    }
  },
  {
    name: 'composite context packs remain deterministic across repeated builds',
    run() {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-core-determinism-'));
      applyTestEnv({ cacheRoot: repoRoot });

      const srcDir = path.join(repoRoot, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a.js'), 'export function alpha(x) { return x + 1; }\n');
      fs.writeFileSync(path.join(srcDir, 'b.js'), 'export function beta() { return 2; }\n');

      const chunkMeta = [
        {
          chunkUid: 'chunk-a',
          chunkId: 'a',
          file: 'src/a.js',
          name: 'alpha',
          kind: 'function',
          start: 0,
          end: 60,
          startLine: 1,
          endLine: 1,
          docmeta: {
            inferredTypes: {
              params: {
                z: [{ type: 'string', confidence: 0.6 }],
                x: [{ type: 'number', confidence: 0.9 }]
              },
              returns: [{ type: 'number', confidence: 0.9 }]
            }
          }
        },
        {
          chunkUid: 'chunk-b',
          chunkId: 'b',
          file: 'src/b.js',
          name: 'beta',
          kind: 'function',
          start: 0,
          end: 40,
          startLine: 1,
          endLine: 1
        }
      ];

      const graphRelations = {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        callGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'chunk-b', file: 'src/b.js', name: 'beta', kind: 'function', chunkId: 'b', out: [], in: ['chunk-a'] },
            { id: 'chunk-a', file: 'src/a.js', name: 'alpha', kind: 'function', chunkId: 'a', out: ['chunk-b'], in: [] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };

      const build = () => assembleCompositeContextPack({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        chunkMeta,
        repoRoot,
        graphRelations,
        includeGraph: true,
        includeTypes: true,
        includeRisk: false,
        includeImports: true,
        includeUsages: true,
        includeCallersCallees: true,
        includePaths: false,
        depth: 1,
        maxBytes: 1024,
        maxTokens: 100,
        maxTypeEntries: 20,
        indexSignature: 'context-pack-determinism-signature',
        indexCompatKey: 'context-pack-determinism-compat',
        now: () => '2026-02-10T00:00:00.000Z'
      });

      const stripDynamic = (value) => {
        const clone = JSON.parse(JSON.stringify(value));
        delete clone.stats;
        if (clone.graph) delete clone.graph.stats;
        return clone;
      };

      assert.deepEqual(stripDynamic(build()), stripDynamic(build()));
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('context pack core contract matrix test passed');
