#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { stableStringify } from '../../../src/shared/stable-json.js';
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
const testRoot = resolveTestCachePath(root, 'relations-determinism');

const chunks = buildRelationBenchChunks({ chunkCount: 1500, edgesPerChunk: 2, fileModulo: 50 });
const fileRelations = buildRelationBenchFileRelations();

const runOnce = async ({ label, maxJsonBytes }) => {
  const outDir = path.join(testRoot, label);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const { rows } = await writeAndLoadRelationBenchGraphArtifacts({
    outDir,
    chunks,
    fileRelations,
    maxJsonBytes
  });

  return { rows };
};

// Vary sharding/spill behavior by using different maxJsonBytes values.
const runSmall = await runOnce({ label: 'small', maxJsonBytes: 32 * 1024 });
const runLarge = await runOnce({ label: 'large', maxJsonBytes: 2 * 1024 * 1024 });

if (stableStringify(runSmall.rows) !== stableStringify(runLarge.rows)) {
  fail('relations determinism test failed: graph_relations rows differ between runs.');
}

console.log('relations determinism test passed');
