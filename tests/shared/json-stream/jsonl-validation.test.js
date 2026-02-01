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
} from '../../../src/shared/artifact-io.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = process.cwd();
const cacheRoot = path.join(root, '.testCache', 'jsonl-validation');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const writeManifest = async (dir, pieces) => {
  const piecesDir = path.join(dir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  await fs.writeFile(
    path.join(piecesDir, 'manifest.json'),
    JSON.stringify({
      version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      pieces
    }, null, 2)
  );
};

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
await writeManifest(chunkDir, [
  { name: 'chunk_meta', path: 'chunk_meta.jsonl', format: 'jsonl' }
]);
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
await writeManifest(repoDir, [
  { name: 'repo_map', path: 'repo_map.jsonl', format: 'jsonl' }
]);
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
const graphPartPath = path.join(graphPartsDir, graphPartName);
await fs.writeFile(
  graphPartPath,
  '{"graph":"callGraph","node":{"id":"a::foo","out":[],"in":[]}}\n'
);
const graphPartStat = await fs.stat(graphPartPath);
const graphMeta = {
  schemaVersion: '0.0.1',
  artifact: 'graph_relations',
  format: 'jsonl-sharded',
  generatedAt: new Date().toISOString(),
  compression: 'none',
  totalRecords: 1,
  totalBytes: graphPartStat.size,
  maxPartRecords: 1,
  maxPartBytes: graphPartStat.size,
  targetMaxBytes: null,
  parts: [{
    path: path.posix.join('graph_relations.parts', graphPartName),
    records: 1,
    bytes: graphPartStat.size
  }],
  extensions: {
    graphs: {
      callGraph: { nodeCount: 1, edgeCount: 0 },
      usageGraph: { nodeCount: 0, edgeCount: 0 },
      importGraph: { nodeCount: 0, edgeCount: 0 }
    },
    version: 1,
    caps: null
  }
};
await fs.writeFile(
  path.join(graphDir, 'graph_relations.meta.json'),
  JSON.stringify(graphMeta, null, 2)
);
await writeManifest(graphDir, [
  { name: 'graph_relations', path: `graph_relations.parts/${graphPartName}`, format: 'jsonl' },
  { name: 'graph_relations_meta', path: 'graph_relations.meta.json', format: 'json' }
]);
const graphRelations = await loadGraphRelations(graphDir);
assert.equal(graphRelations.callGraph.nodes.length, 1);

const badGraphDir = path.join(cacheRoot, 'graph-relations-bad');
const badGraphPartsDir = path.join(badGraphDir, 'graph_relations.parts');
await fs.mkdir(badGraphPartsDir, { recursive: true });
await fs.writeFile(
  path.join(badGraphPartsDir, 'graph_relations.part-00000.jsonl'),
  '{"graph":"callGraph"}\n'
);
const badGraphPartPath = path.join(badGraphPartsDir, 'graph_relations.part-00000.jsonl');
const badGraphPartStat = await fs.stat(badGraphPartPath);
const badGraphMeta = {
  schemaVersion: '0.0.1',
  artifact: 'graph_relations',
  format: 'jsonl-sharded',
  generatedAt: new Date().toISOString(),
  compression: 'none',
  totalRecords: 1,
  totalBytes: badGraphPartStat.size,
  maxPartRecords: 1,
  maxPartBytes: badGraphPartStat.size,
  targetMaxBytes: null,
  parts: [{
    path: path.posix.join('graph_relations.parts', 'graph_relations.part-00000.jsonl'),
    records: 1,
    bytes: badGraphPartStat.size
  }],
  extensions: {
    graphs: {
      callGraph: { nodeCount: 0, edgeCount: 0 },
      usageGraph: { nodeCount: 0, edgeCount: 0 },
      importGraph: { nodeCount: 0, edgeCount: 0 }
    },
    version: 1,
    caps: null
  }
};
await fs.writeFile(
  path.join(badGraphDir, 'graph_relations.meta.json'),
  JSON.stringify(badGraphMeta, null, 2)
);
await writeManifest(badGraphDir, [
  { name: 'graph_relations', path: 'graph_relations.parts/graph_relations.part-00000.jsonl', format: 'jsonl' },
  { name: 'graph_relations_meta', path: 'graph_relations.meta.json', format: 'json' }
]);
let graphErr = null;
try {
  await loadGraphRelations(badGraphDir);
} catch (err) {
  graphErr = err;
}
assert.ok(graphErr, 'expected graph_relations required keys to throw');
assert.equal(graphErr.code, 'ERR_JSONL_INVALID');

console.log('jsonl validation test passed');

