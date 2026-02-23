import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonArrayFile, writeJsonObjectFile } from '../../../src/shared/json-stream.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();

const pad = (value, width = 6) => String(value).padStart(width, '0');
const chunkId = (i) => `chunk-${pad(i)}`;

const buildGraphFixtureData = ({ nodes, fanout, file }) => {
  const edgesOut = Array.from({ length: nodes }, () => []);
  for (let i = 0; i < nodes; i += 1) {
    const targets = [];
    for (let j = 1; j <= fanout; j += 1) {
      targets.push((i + j) % nodes);
    }
    targets.sort((a, b) => a - b);
    edgesOut[i] = targets;
  }

  const edgesIn = Array.from({ length: nodes }, () => []);
  for (let i = 0; i < nodes; i += 1) {
    for (const target of edgesOut[i]) edgesIn[target].push(i);
  }
  for (const list of edgesIn) list.sort((a, b) => a - b);

  const ids = Array.from({ length: nodes }, (_, i) => chunkId(i));
  const graphNodes = ids.map((id, i) => ({
    id,
    file,
    out: edgesOut[i].map((target) => ids[target]),
    in: edgesIn[i].map((source) => ids[source])
  }));

  const generatedAt = new Date().toISOString();
  const graphRelations = {
    version: 1,
    generatedAt,
    callGraph: {
      nodeCount: nodes,
      edgeCount: nodes * fanout,
      nodes: graphNodes
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  };

  const offsets = new Array(nodes + 1);
  offsets[0] = 0;
  const edges = [];
  for (let i = 0; i < nodes; i += 1) {
    const targets = edgesOut[i];
    offsets[i + 1] = offsets[i] + targets.length;
    for (const target of targets) edges.push(target);
  }

  const graphRelationsCsr = {
    version: 1,
    generatedAt,
    graphs: {
      callGraph: {
        nodeCount: nodes,
        edgeCount: edges.length,
        nodes: ids,
        offsets,
        edges
      },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [], offsets: [0], edges: [] },
      importGraph: { nodeCount: 0, edgeCount: 0, nodes: [], offsets: [0], edges: [] }
    }
  };

  return { graphRelations, graphRelationsCsr, ids };
};

export const createGraphBenchFixture = async ({
  tempLabel,
  repoText,
  nodes = 2000,
  fanout = 6,
  fileRel = 'src/file.js',
  chunkEndLine = 1
}) => {
  const tempRoot = resolveTestCachePath(root, tempLabel);
  const repoRoot = path.join(tempRoot, 'repo');
  const indexDir = path.join(tempRoot, 'index-code');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await fs.mkdir(path.dirname(path.join(repoRoot, fileRel)), { recursive: true });

  const repoFile = path.join(repoRoot, fileRel);
  await fs.writeFile(repoFile, repoText, 'utf8');
  const repoBytes = Buffer.byteLength(repoText, 'utf8');

  const { graphRelations, graphRelationsCsr, ids } = buildGraphFixtureData({
    nodes,
    fanout,
    file: fileRel
  });

  const chunkMeta = ids.map((chunkUid, i) => ({
    id: i,
    chunkUid,
    file: fileRel,
    start: 0,
    end: repoBytes,
    startLine: 1,
    endLine: chunkEndLine,
    kind: 'code',
    name: chunkUid
  }));

  await writeJsonArrayFile(path.join(indexDir, 'chunk_meta.json'), chunkMeta, { atomic: true });
  await writeJsonObjectFile(path.join(indexDir, 'graph_relations.json'), { fields: graphRelations, atomic: true });
  await writeJsonObjectFile(path.join(indexDir, 'graph_relations_csr.json'), { fields: graphRelationsCsr, atomic: true });
  await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), {
    fields: {
      artifactSurfaceVersion: 'test',
      buildId: 'bench-contract',
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
        stage: 'bench-contract',
        pieces: [
          { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
          { name: 'graph_relations', path: 'graph_relations.json', format: 'json' },
          { name: 'graph_relations_csr', path: 'graph_relations_csr.json', format: 'json' }
        ]
      }
    },
    atomic: true
  });

  return { indexDir, repoRoot };
};

export const runGraphBenchCompare = ({
  benchScript,
  indexDir,
  repoRoot,
  iterations = 6,
  depth = 2
}) => {
  const result = spawnSync(process.execPath, [
    benchScript,
    '--mode',
    'compare',
    '--index',
    indexDir,
    '--repo',
    repoRoot,
    '--iterations',
    String(iterations),
    '--depth',
    String(depth)
  ], { cwd: root, env: process.env, encoding: 'utf8' });

  if (result.status !== 0) {
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    throw new Error(
      `graph bench failed (status=${result.status ?? 'unknown'})\n${stdout}\n${stderr}`.trim()
    );
  }

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const match = output.match(/\{[\s\S]*\}\s*$/);
  assert.ok(match, 'expected bench to emit trailing JSON');

  const payload = JSON.parse(match[0]);
  assert.equal(payload.ok, true);
  return payload.result;
};

