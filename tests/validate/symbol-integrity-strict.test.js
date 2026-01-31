#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../src/shared/json-stream.js';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'symbol-integrity-strict');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot, indexDir, manifest } = await createBaseIndex({ rootDir: tempRoot });
const chunkMeta = JSON.parse(await fs.readFile(path.join(indexDir, 'chunk_meta.json'), 'utf8'));
const existingUid = chunkMeta?.[0]?.chunkUid || chunkMeta?.[0]?.metaV2?.chunkUid || 'ck:test:chunk_0';

const makeRef = (name, uid) => ({
  v: 1,
  targetName: name,
  kindHint: null,
  importHint: null,
  candidates: [
    {
      symbolId: `sym:${uid}`,
      chunkUid: uid,
      symbolKey: `symkey:${name}`,
      signatureKey: null,
      kindGroup: 'function'
    }
  ],
  status: 'resolved',
  resolved: { symbolId: `sym:${uid}`, chunkUid: uid }
});

const symbols = [
  {
    v: 1,
    symbolId: 'sym:missing',
    scopedId: 'scope:missing',
    symbolKey: 'symkey:missing',
    qualifiedName: 'Missing',
    kindGroup: 'function',
    file: 'src/missing.js',
    virtualPath: 'src/missing.js',
    chunkUid: 'uid-missing'
  }
];

const symbolOccurrences = [
  {
    v: 1,
    host: { file: 'src/a.js', chunkUid: 'uid-missing' },
    role: 'call',
    ref: {
      v: 1,
      targetName: 'Missing',
      kindHint: null,
      importHint: null,
      candidates: [],
      status: 'unresolved',
      resolved: null
    },
    range: null
  }
];

const symbolEdges = [
  {
    v: 1,
    type: 'call',
    from: { file: 'src/a.js', chunkUid: existingUid },
    to: makeRef('Missing', 'uid-missing')
  }
];

await writeJsonLinesFile(path.join(indexDir, 'symbols.jsonl'), symbols, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'symbol_occurrences.jsonl'), symbolOccurrences, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'symbol_edges.jsonl'), symbolEdges, { atomic: true });

manifest.pieces.push({ type: 'symbols', name: 'symbols', format: 'jsonl', path: 'symbols.jsonl', count: symbols.length });
manifest.pieces.push({
  type: 'symbols',
  name: 'symbol_occurrences',
  format: 'jsonl',
  path: 'symbol_occurrences.jsonl',
  count: symbolOccurrences.length
});
manifest.pieces.push({ type: 'symbols', name: 'symbol_edges', format: 'jsonl', path: 'symbol_edges.jsonl', count: symbolEdges.length });

await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(!report.ok, 'expected symbol integrity violations to fail strict validation');
const issueText = report.issues.join('; ');
assert.ok(
  issueText.includes('symbols chunkUid missing')
    || issueText.includes('symbol_occurrences host chunkUid missing')
    || issueText.includes('symbol_edges resolved chunkUid missing'),
  `expected symbol integrity issue, got: ${issueText}`
);

console.log('symbol integrity strict validation test passed');
