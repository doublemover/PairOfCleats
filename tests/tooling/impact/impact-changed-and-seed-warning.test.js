#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runImpactCli } from '../../../src/integrations/tooling/impact.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-warning-'));
const indexDir = path.join(repoRoot, 'index-code');
const piecesDir = path.join(indexDir, 'pieces');
fs.mkdirSync(piecesDir, { recursive: true });

const manifest = {
  compatibilityKey: 'compat-impact-warning',
  pieces: [
    { name: 'graph_relations', path: 'pieces/graph_relations.json' },
    { name: 'symbol_edges', path: 'pieces/symbol_edges.json' },
    { name: 'call_sites', path: 'pieces/call_sites.json' }
  ]
};

fs.writeFileSync(path.join(piecesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(piecesDir, 'graph_relations.json'),
  JSON.stringify(
    {
      version: 1,
      callGraph: {
        nodeCount: 1,
        edgeCount: 0,
        nodes: [{ id: 'chunk-a', file: 'src/a.js', out: [], in: [] }]
      },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
      importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
    },
    null,
    2
  )
);
fs.writeFileSync(path.join(piecesDir, 'symbol_edges.json'), JSON.stringify([], null, 2));
fs.writeFileSync(path.join(piecesDir, 'call_sites.json'), JSON.stringify([], null, 2));
fs.writeFileSync(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([], null, 2));

const payload = await runImpactCli([
  '--repo',
  repoRoot,
  '--seed',
  'chunk:chunk-a',
  '--changed',
  'src/alpha.js',
  '--depth',
  '1',
  '--direction',
  'downstream',
  '--json'
]);

assert(payload?.warnings?.some((warning) => warning?.code === 'CHANGED_IGNORED'));
console.log('impact changed+seed warning test passed');
