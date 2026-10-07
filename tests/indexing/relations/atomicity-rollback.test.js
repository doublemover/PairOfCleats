#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES, loadJsonArrayArtifact, readJsonFile } from '../../../src/shared/artifact-io.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { fromPosix } from '../../../src/shared/file-paths.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  buildRelationBenchChunks,
  buildRelationBenchFileRelations
} from '../../../tools/bench/index/relations-fixture.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { writeAndLoadRelationBenchGraphArtifacts } from './helpers/graph-relations-artifact-fixture.js';

applyTestEnv({ testing: '1' });

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'relations-atomicity-rollback');
const outDir = path.join(testRoot, 'index-code');

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const fileRelations = buildRelationBenchFileRelations();
const chunks = buildRelationBenchChunks({
  chunkCount: 250,
  edgesPerChunk: 2,
  fileModulo: 20,
  edgeCountForChunk: (chunkIndex) => (chunkIndex === 0 ? 1500 : 2)
});

const runBuild = async ({ maxJsonBytes }) => {
  const { pieces, rows } = await writeAndLoadRelationBenchGraphArtifacts({
    outDir,
    chunks,
    fileRelations,
    maxJsonBytes
  });
  return { pieces, rows };
};

// First run should succeed and write stable artifacts.
const baseline = await runBuild({ maxJsonBytes: 512 * 1024 });
const baselineHash = stableStringify(baseline.rows);

// Second run should fail on a too-small maxJsonBytes (single-row overflow) but must not delete baseline.
let threw = false;
try {
  await runBuild({ maxJsonBytes: 96 });
} catch (err) {
  threw = true;
  const message = err?.message || String(err);
  if (!message.includes('exceeds maxBytes')) {
    fail(`relations atomicity rollback test failed: unexpected error: ${message}`);
  }
}
if (!threw) {
  fail('relations atomicity rollback test failed: expected rebuild to throw.');
}

// Verify baseline artifacts still load after the failed rebuild.
const metaRaw = readJsonFile(path.join(outDir, 'graph_relations.meta.json'));
const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
const parts = Array.isArray(meta?.parts) ? meta.parts : [];
if (!parts.length) {
  fail('relations atomicity rollback test failed: missing graph_relations parts after failure.');
}

const manifestAfter = {
  version: 2,
  generatedAt: new Date().toISOString(),
  mode: 'code',
  stage: 'stage2',
  pieces: [
    ...parts.map((part) => ({ type: 'relations', name: 'graph_relations', format: 'jsonl', path: part.path })),
    { type: 'relations', name: 'graph_relations_meta', format: 'json', path: 'graph_relations.meta.json' }
  ]
};
for (const part of parts) {
  const abs = path.join(outDir, fromPosix(part.path));
  await fs.stat(abs).catch(() => fail(`relations atomicity rollback test failed: missing ${part.path}`));
}

const loadedAfter = await loadJsonArrayArtifact(outDir, 'graph_relations', {
  manifest: manifestAfter,
  strict: true,
  maxBytes: MAX_JSON_BYTES
});

if (stableStringify(loadedAfter) !== baselineHash) {
  fail('relations atomicity rollback test failed: graph_relations output changed after failed rebuild.');
}

console.log('relations atomicity rollback test passed');

