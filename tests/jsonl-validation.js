#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadChunkMeta,
  loadGraphRelations,
  loadJsonArrayArtifact,
  readJsonLinesArray,
  readJsonLinesArraySync
} from '../src/shared/artifact-io.js';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'jsonl-validation');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const okPath = path.join(cacheRoot, 'ok.jsonl');
await fs.writeFile(okPath, '{"id":1}\n{"id":2}\n\n');
const okSync = readJsonLinesArraySync(okPath);
assert.equal(okSync.length, 2);
const okAsync = await readJsonLinesArray(okPath);
assert.equal(okAsync.length, 2);

const arrayPath = path.join(cacheRoot, 'array.jsonl');
await fs.writeFile(arrayPath, '[\n{"id":1}\n]\n');
let arrayErr = null;
try {
  readJsonLinesArraySync(arrayPath);
} catch (err) {
  arrayErr = err;
}
assert.ok(arrayErr, 'expected JSONL array fragments to throw');
assert.equal(arrayErr.code, 'ERR_JSONL_INVALID');

const badPath = path.join(cacheRoot, 'bad.jsonl');
await fs.writeFile(badPath, '{"id":1}\n{"id":2"\n');
let badErr = null;
try {
  await readJsonLinesArray(badPath);
} catch (err) {
  badErr = err;
}
assert.ok(badErr, 'expected invalid JSONL to throw');
assert.equal(badErr.code, 'ERR_JSONL_INVALID');
assert.ok(String(badErr.message).includes(':2'), 'expected line number in error message');

const truncatedPath = path.join(cacheRoot, 'truncated.jsonl');
await fs.writeFile(truncatedPath, '{\"id\":1}\\n{\"id\":2');
let truncatedErr = null;
try {
  await readJsonLinesArray(truncatedPath);
} catch (err) {
  truncatedErr = err;
}
assert.ok(truncatedErr, 'expected truncated JSONL line to throw');
assert.equal(truncatedErr.code, 'ERR_JSONL_INVALID');
assert.ok(String(truncatedErr.message).includes(':2'), 'expected line number in truncated JSONL error');

const chunkDir = path.join(cacheRoot, 'chunk-meta');
await fs.mkdir(chunkDir, { recursive: true });
await fs.writeFile(path.join(chunkDir, 'chunk_meta.jsonl'), '{"id":1,"start":0,"end":1}\n{}\n');
let chunkErr = null;
try {
  await loadChunkMeta(chunkDir);
} catch (err) {
  chunkErr = err;
}
assert.ok(chunkErr, 'expected missing required keys to throw');
assert.equal(chunkErr.code, 'ERR_JSONL_INVALID');
assert.ok(String(chunkErr.message).includes('Missing required keys'));

const repoDir = path.join(cacheRoot, 'repo-map');
await fs.mkdir(repoDir, { recursive: true });
await fs.writeFile(path.join(repoDir, 'repo_map.jsonl'), '{"file":"a.js","name":"foo"}\n{"file":"b.js"}\n');
let repoErr = null;
try {
  await loadJsonArrayArtifact(repoDir, 'repo_map');
} catch (err) {
  repoErr = err;
}
assert.ok(repoErr, 'expected repo_map required keys to throw');
assert.equal(repoErr.code, 'ERR_JSONL_INVALID');
assert.ok(String(repoErr.message).includes('Missing required keys'));

const graphDir = path.join(cacheRoot, 'graph-relations');
const graphPartsDir = path.join(graphDir, 'graph_relations.parts');
await fs.mkdir(graphPartsDir, { recursive: true });
const graphPartName = 'graph_relations.part-00000.jsonl';
await fs.writeFile(
  path.join(graphPartsDir, graphPartName),
  '{"graph":"callGraph","node":{"id":"a::foo","out":[],"in":[]}}\n'
);
await fs.writeFile(
  path.join(graphDir, 'graph_relations.meta.json'),
  JSON.stringify({
    format: 'jsonl',
    version: 1,
    generatedAt: new Date().toISOString(),
    graphs: {
      callGraph: { nodeCount: 1, edgeCount: 0 },
      usageGraph: { nodeCount: 0, edgeCount: 0 },
      importGraph: { nodeCount: 0, edgeCount: 0 }
    },
    parts: [path.join('graph_relations.parts', graphPartName)]
  }, null, 2)
);
const graphRelations = await loadGraphRelations(graphDir);
assert.equal(graphRelations.callGraph.nodes.length, 1);

const badGraphDir = path.join(cacheRoot, 'graph-relations-bad');
const badGraphPartsDir = path.join(badGraphDir, 'graph_relations.parts');
await fs.mkdir(badGraphPartsDir, { recursive: true });
await fs.writeFile(
  path.join(badGraphPartsDir, 'graph_relations.part-00000.jsonl'),
  '{"graph":"callGraph"}\n'
);
await fs.writeFile(
  path.join(badGraphDir, 'graph_relations.meta.json'),
  JSON.stringify({
    format: 'jsonl',
    version: 1,
    generatedAt: new Date().toISOString(),
    graphs: {
      callGraph: { nodeCount: 0, edgeCount: 0 },
      usageGraph: { nodeCount: 0, edgeCount: 0 },
      importGraph: { nodeCount: 0, edgeCount: 0 }
    },
    parts: [path.join('graph_relations.parts', 'graph_relations.part-00000.jsonl')]
  }, null, 2)
);
let graphErr = null;
try {
  await loadGraphRelations(badGraphDir);
} catch (err) {
  graphErr = err;
}
assert.ok(graphErr, 'expected graph_relations required keys to throw');
assert.equal(graphErr.code, 'ERR_JSONL_INVALID');

console.log('jsonl validation test passed');
