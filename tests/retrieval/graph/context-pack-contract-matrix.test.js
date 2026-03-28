#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { assembleCompositeContextPack, assembleCompositeContextPackStreaming } from '../../../src/context-pack/assemble.js';
import { buildGraphContextPack } from '../../../src/graph/context-pack.js';
import { validateGraphContextPack } from '../../../src/contracts/validators/analysis.js';
import { CONTEXT_PACK_RISK_CONTRACT_VERSION } from '../../../src/contracts/context-pack-risk-contract.js';
import { validateCompositeContextPack } from '../../../src/contracts/validators/analysis.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifactSync,
  MAX_JSON_BYTES,
  readCompatibilityKey
} from '../../../src/shared/artifact-io.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';

const root = process.cwd();
const graphFixturePath = (...parts) => path.join(
  root,
  'tests',
  'fixtures',
  'graph',
  'context-pack',
  ...parts
);

const loadFixture = (name) => JSON.parse(fs.readFileSync(graphFixturePath(name), 'utf8'));

const withStreamingFixture = async (suffix, build) => {
  applyTestEnv({ testing: '1' });
  const tempRoot = resolveTestCachePath(root, suffix);
  const repoRoot = path.join(tempRoot, 'repo');
  const indexDir = path.join(tempRoot, 'index-code');
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  try {
    await build({ tempRoot, repoRoot, indexDir });
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
};

const commonGraphCaps = {
  maxDepth: 2,
  maxFanoutPerNode: 10,
  maxNodes: 10,
  maxEdges: 10,
  maxPaths: 5,
  maxCandidates: 5,
  maxWorkUnits: 100
};

const cases = [
  {
    name: 'composite context packs assemble excerpts, graph slices, and type facts',
    async run() {
      const repoRoot = process.cwd();
      const samplePath = path.join(repoRoot, 'tests', 'fixtures', 'context-pack', 'sample.js');
      const fileText = fs.readFileSync(samplePath, 'utf8');
      const start = fileText.indexOf('function alpha');
      const end = fileText.indexOf('}', start) + 1;
      const chunkMeta = [
        {
          id: 0,
          file: 'tests/fixtures/context-pack/sample.js',
          chunkUid: 'chunk-alpha',
          start,
          end,
          startLine: 1,
          endLine: 3,
          docmeta: {
            inferredTypes: {
              returns: [{ type: 'number', source: 'heur', confidence: 0.9 }]
            }
          }
        }
      ];
      const graphRelations = {
        callGraph: { nodes: [{ id: 'chunk-alpha', out: [] }] },
        usageGraph: { nodes: [] },
        importGraph: { nodes: [] }
      };

      const pack = assembleCompositeContextPack({
        seed: { type: 'chunk', chunkUid: 'chunk-alpha' },
        chunkMeta,
        repoRoot,
        graphRelations,
        includeGraph: true,
        includeTypes: true,
        includeRisk: false,
        depth: 1,
        maxBytes: 200,
        indexCompatKey: 'compat-context-pack'
      });

      assert.ok(pack.primary.excerpt.includes('function alpha'));
      assert.ok(pack.graph);
      assert.ok((pack.types?.facts?.length || 0) > 0);
    }
  },
  {
    name: 'basic graph context pack validates and includes neighbor edge',
    async run() {
      const graphRelations = loadFixture('basic.json');
      const pack = buildGraphContextPack({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations,
        direction: 'out',
        depth: 1,
        caps: commonGraphCaps,
        indexCompatKey: 'compat-basic'
      });
      const validation = validateGraphContextPack(pack);
      assert.equal(validation.ok, true, validation.errors?.join('; '));
      const nodeIds = pack.nodes.map((node) => node.ref?.chunkUid);
      assert.equal(nodeIds.includes('chunk-a'), true);
      assert.equal(nodeIds.includes('chunk-b'), true);
      assert.equal(pack.edges.length, 1);
    }
  },
  {
    name: 'risk slices assemble and validate inside composite context packs',
    async run() {
      applyTestEnv();
      const { fixtureRoot, codeDir } = await ensureFixtureIndex({
        fixtureName: 'risk-interprocedural/js-simple',
        cacheName: 'retrieval-context-pack-risk',
        cacheScope: 'isolated',
        requireRiskTags: true,
        requiredModes: ['code']
      });

      const summaries = loadJsonArrayArtifactSync(codeDir, 'risk_summaries', {
        maxBytes: MAX_JSON_BYTES,
        strict: true
      });
      const seedSummary = Array.isArray(summaries)
        ? summaries.find((entry) => typeof entry?.chunkUid === 'string' && entry.chunkUid)
        : null;
      assert.ok(seedSummary?.chunkUid);

      const chunkMeta = await loadChunkMeta(codeDir, {
        maxBytes: MAX_JSON_BYTES,
        strict: true
      });
      const indexCompatKey = readCompatibilityKey(codeDir, {
        maxBytes: MAX_JSON_BYTES,
        strict: true
      }).key;
      const indexSignature = await buildIndexSignature(codeDir);

      const pack = assembleCompositeContextPack({
        seed: { type: 'chunk', chunkUid: seedSummary.chunkUid },
        chunkMeta,
        repoRoot: fixtureRoot,
        indexDir: codeDir,
        includeGraph: false,
        includeTypes: false,
        includeRisk: true,
        includeImports: false,
        includeUsages: false,
        includeCallersCallees: false,
        indexCompatKey,
        indexSignature
      });

      assert.equal(pack.risk?.status, 'ok');
      assert.equal(pack.risk?.contractVersion, CONTEXT_PACK_RISK_CONTRACT_VERSION);
      assert.ok(Array.isArray(pack.risk?.flows) && pack.risk.flows.length > 0);
      assert.ok(typeof pack.primary?.excerptHash === 'string' && pack.primary.excerptHash.length > 0);
      assert.equal(pack.risk?.provenance?.indexSignature, pack.provenance?.indexSignature);
      assert.equal(pack.risk?.provenance?.indexCompatKey, pack.provenance?.indexCompatKey);
      assert.match(pack.risk?.provenance?.ruleBundle?.fingerprint || '', /^sha1:/);
      assert.ok(pack.risk?.provenance?.artifactRefs?.stats?.entrypoint);

      const validation = validateCompositeContextPack(pack);
      assert.equal(validation.ok, true, validation.errors.join(', '));
    }
  },
  {
    name: 'graph caps emit truncation metadata when exceeded',
    async run() {
      const graphRelations = loadFixture('caps.json');
      const pack = buildGraphContextPack({
        seed: { type: 'chunk', chunkUid: 'seed' },
        graphRelations,
        direction: 'out',
        depth: 1,
        caps: {
          maxDepth: 1,
          maxFanoutPerNode: 2,
          maxNodes: 3,
          maxEdges: 2,
          maxPaths: 1,
          maxCandidates: 5,
          maxWorkUnits: 100
        },
        indexCompatKey: 'compat-caps'
      });
      const validation = validateGraphContextPack(pack);
      assert.equal(validation.ok, true, validation.errors?.join('; '));
      assert.ok(Array.isArray(pack.truncation) && pack.truncation.length > 0);
      const caps = new Set(pack.truncation.map((entry) => entry.cap));
      assert.equal(
        caps.has('maxFanoutPerNode') || caps.has('maxEdges') || caps.has('maxNodes'),
        true
      );
    }
  },
  {
    name: 'graph context pack output is deterministic apart from stats',
    async run() {
      const graphRelations = loadFixture('basic.json');
      const buildOnce = () => buildGraphContextPack({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations,
        direction: 'out',
        depth: 1,
        caps: commonGraphCaps,
        indexCompatKey: 'compat-determinism',
        now: () => '2026-02-01T00:00:00.000Z'
      });
      const stripStats = (value) => {
        const cloned = JSON.parse(JSON.stringify(value));
        delete cloned.stats;
        return cloned;
      };
      assert.equal(
        JSON.stringify(stripStats(buildOnce())),
        JSON.stringify(stripStats(buildOnce()))
      );
    }
  },
  {
    name: 'streaming assembly resolves chunk and file seeds deterministically',
    async run() {
      await withStreamingFixture('context-pack-streaming-assembly-matrix', async ({ repoRoot, indexDir }) => {
        const repoFile = path.join(repoRoot, 'src', 'file.js');
        const repoText = [
          'export function greet(name) {',
          '  return `hi ${name}`;',
          '}',
          ''
        ].join('\n');
        await fsPromises.writeFile(repoFile, repoText, 'utf8');
        const repoBytes = Buffer.byteLength(repoText, 'utf8');
        const chunkUid = 'chunk-000001';
        await fsPromises.writeFile(
          path.join(indexDir, 'chunk_uid_map.jsonl'),
          `${JSON.stringify({
            docId: 0,
            chunkId: '0',
            chunkUid,
            file: 'src/file.js',
            start: 0,
            end: repoBytes
          })}\n`,
          'utf8'
        );
        await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), {
          fields: {
            artifactSurfaceVersion: 'test',
            buildId: 'streaming-assembly',
            mode: 'code',
            compatibilityKey: 'compat-test'
          },
          atomic: true
        });
        await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
          fields: {
            fields: {
              version: 2,
              artifactSurfaceVersion: 'test',
              compatibilityKey: 'compat-test',
              generatedAt: new Date().toISOString(),
              mode: 'code',
              stage: 'streaming-assembly',
              pieces: [
                { name: 'chunk_uid_map', path: 'chunk_uid_map.jsonl', format: 'jsonl' }
              ]
            }
          },
          atomic: true
        });
        const stripStats = (value) => {
          const cloned = JSON.parse(JSON.stringify(value));
          delete cloned.stats;
          return cloned;
        };
        const fixedNow = () => '2026-02-01T00:00:00.000Z';
        const common = {
          repoRoot,
          indexDir,
          strict: true,
          indexCompatKey: 'compat-test',
          now: fixedNow,
          includeGraph: false,
          includeTypes: false,
          includeRisk: false,
          includeImports: false,
          includeUsages: false,
          includeCallersCallees: false
        };
        const payloadChunk = await assembleCompositeContextPackStreaming({
          ...common,
          seed: { type: 'chunk', chunkUid }
        });
        assert.equal(payloadChunk?.primary?.file, 'src/file.js');
        assert.ok(payloadChunk.primary.excerpt.includes('export function greet'));
        assert.equal(
          Array.isArray(payloadChunk.warnings)
            ? payloadChunk.warnings.some((w) => w?.code === 'CHUNK_UID_MAP_MISS')
            : false,
          false
        );

        const payloadFile = await assembleCompositeContextPackStreaming({
          ...common,
          seed: { type: 'file', path: 'src/file.js' }
        });
        assert.equal(payloadFile?.primary?.file, 'src/file.js');
        assert.ok(payloadFile.primary.excerpt.includes('export function greet'));

        const payloadRepeat = await assembleCompositeContextPackStreaming({
          ...common,
          seed: { type: 'chunk', chunkUid }
        });
        assert.deepEqual(stripStats(payloadRepeat), stripStats(payloadChunk));
      });
    }
  },
  {
    name: 'seed indexing reports indexed rows and lookup strategy',
    async run() {
      await withStreamingFixture('context-pack-seed-indexing-matrix', async ({ repoRoot, indexDir }) => {
        const repoFile = path.join(repoRoot, 'src', 'main.js');
        const repoText = [
          'export function main(name) {',
          '  return `hello ${name}`;',
          '}',
          ''
        ].join('\n');
        await fsPromises.writeFile(repoFile, repoText, 'utf8');
        const repoBytes = Buffer.byteLength(repoText, 'utf8');
        const targetChunkUid = 'chunk-target-037';
        const rowCount = 50;
        const lines = [];
        for (let i = 0; i < rowCount; i += 1) {
          const isTarget = i === 37;
          const chunkUid = isTarget ? targetChunkUid : `chunk-${String(i).padStart(3, '0')}`;
          lines.push(JSON.stringify({
            docId: i,
            chunkId: String(i),
            chunkUid,
            file: isTarget ? 'src/main.js' : `src/file-${i}.js`,
            start: 0,
            end: isTarget ? repoBytes : 16
          }));
        }
        await fsPromises.writeFile(path.join(indexDir, 'chunk_uid_map.jsonl'), `${lines.join('\n')}\n`, 'utf8');
        await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), {
          fields: {
            artifactSurfaceVersion: 'test',
            buildId: 'seed-indexing',
            mode: 'code',
            compatibilityKey: 'compat-seed-indexing'
          },
          atomic: true
        });
        await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
          fields: {
            fields: {
              version: 2,
              artifactSurfaceVersion: 'test',
              compatibilityKey: 'compat-seed-indexing',
              generatedAt: new Date().toISOString(),
              mode: 'code',
              stage: 'seed-indexing',
              pieces: [
                { name: 'chunk_uid_map', path: 'chunk_uid_map.jsonl', format: 'jsonl' }
              ]
            }
          },
          atomic: true
        });
        const common = {
          repoRoot,
          indexDir,
          strict: true,
          indexCompatKey: 'compat-seed-indexing',
          now: () => '2026-02-01T00:00:00.000Z',
          includeGraph: false,
          includeTypes: false,
          includeRisk: false,
          includeImports: false,
          includeUsages: false,
          includeCallersCallees: false
        };
        const envelopeSeedPayload = await assembleCompositeContextPackStreaming({
          ...common,
          seed: {
            v: 1,
            status: 'resolved',
            resolved: { type: 'chunk', chunkUid: targetChunkUid },
            candidates: [
              { type: 'chunk', chunkUid: 'missing-chunk' },
              { type: 'file', path: 'src/missing.js' }
            ]
          }
        });
        assert.equal(envelopeSeedPayload?.primary?.file, 'src/main.js');
        assert.ok(envelopeSeedPayload.primary.excerpt.includes('export function main'));
        assert.equal(envelopeSeedPayload?.stats?.seedResolution?.strategy, 'chunk_uid_map_index');
        assert.equal(envelopeSeedPayload?.stats?.seedResolution?.rowsIndexed, rowCount);
        assert.equal(envelopeSeedPayload?.stats?.seedResolution?.hit, true);

        const fileSeedPayload = await assembleCompositeContextPackStreaming({
          ...common,
          seed: { type: 'file', path: 'src/main.js' }
        });
        assert.equal(fileSeedPayload?.primary?.file, 'src/main.js');
        assert.equal(fileSeedPayload?.stats?.seedResolution?.rowsIndexed, rowCount);
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('graph context pack contract matrix test passed');
