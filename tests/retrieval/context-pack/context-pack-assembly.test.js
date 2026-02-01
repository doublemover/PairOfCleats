#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../../src/context-pack/assemble.js';

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
  callGraph: {
    nodes: [
      { id: 'chunk-alpha', out: [] }
    ]
  },
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

assert(pack.primary.excerpt.includes('function alpha'), 'expected primary excerpt to include function alpha');
assert(pack.graph, 'expected graph slice to be present');
assert(pack.types?.facts?.length > 0, 'expected type facts when includeTypes=true');

console.log('context pack assembly test passed');
