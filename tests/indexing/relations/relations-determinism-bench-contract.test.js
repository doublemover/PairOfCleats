#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES, loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'relations-determinism');

const buildChunks = ({ chunkCount = 1500, edgesPerChunk = 2 } = {}) => {
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    const file = `src/file-${String(i % 50).padStart(3, '0')}.js`;
    const uid = `u${i}`;
    const callDetails = [];
    for (let j = 1; j <= edgesPerChunk; j += 1) {
      callDetails.push({ targetChunkUid: `u${(i + j) % chunkCount}` });
    }
    chunks[i] = {
      file,
      ext: '.js',
      name: `sym${i}`,
      kind: 'FunctionDeclaration',
      chunkUid: uid,
      metaV2: {
        chunkUid: uid,
        lang: 'javascript',
        effective: { languageId: 'javascript' },
        symbol: { symbolId: `sym-${i}` }
      },
      codeRelations: { callDetails }
    };
  }
  return chunks;
};

const buildFileRelations = () => new Map([
  ['src/file-000.js', { importLinks: ['src/file-001.js'] }],
  ['src/file-001.js', { importLinks: ['src/file-000.js'] }]
]);

const chunks = buildChunks();
const fileRelations = buildFileRelations();

const runOnce = async ({ label, maxJsonBytes }) => {
  const outDir = path.join(testRoot, label);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const pieces = [];
  const toPosix = (value) => value.split(path.sep).join('/');
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
  const removeArtifact = async (targetPath) => {
    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
  };

  await enqueueGraphRelationsArtifacts({
    graphRelations: null,
    chunks,
    fileRelations,
    callSites: null,
    caps: null,
    outDir,
    maxJsonBytes,
    byteBudget: null,
    log: null,
    enqueueWrite: () => {
      throw new Error('enqueueWrite should not be called by streaming graph_relations build');
    },
    addPieceFile: (entry, filePath) => {
      pieces.push({ ...entry, path: formatArtifactLabel(filePath) });
    },
    formatArtifactLabel,
    removeArtifact,
    stageCheckpoints: null
  });

  const manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    mode: 'code',
    stage: 'stage2',
    pieces
  };

  const rows = await loadJsonArrayArtifact(outDir, 'graph_relations', {
    manifest,
    strict: true,
    maxBytes: MAX_JSON_BYTES
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
