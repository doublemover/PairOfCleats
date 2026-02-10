#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES, loadJsonArrayArtifact, readJsonFile } from '../../../src/shared/artifact-io.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { fromPosix } from '../../../src/shared/files.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'relations-atomicity-rollback');
const outDir = path.join(testRoot, 'index-code');

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const buildChunks = ({ chunkCount = 250, edgesFromFirst = 1500 } = {}) => {
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    const file = `src/file-${String(i % 20).padStart(3, '0')}.js`;
    const uid = `u${i}`;
    const callDetails = [];
    const edgeCount = i === 0 ? edgesFromFirst : 2;
    for (let j = 1; j <= edgeCount; j += 1) {
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

const fileRelations = new Map([
  ['src/file-000.js', { importLinks: ['src/file-001.js'] }],
  ['src/file-001.js', { importLinks: ['src/file-000.js'] }]
]);
const chunks = buildChunks();

const runBuild = async ({ maxJsonBytes }) => {
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

