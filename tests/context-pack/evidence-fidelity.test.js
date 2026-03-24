#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-evidence-'));
const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'alpha.js'), 'const alpha = input => input.trim();\n', 'utf8');

const completeChunkMeta = [
  {
    chunkUid: 'chunk-file',
    file: 'src/alpha.js',
    start: 0,
    end: 36,
    startLine: 1,
    endLine: 1
  }
];

const truncatedPack = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-file' },
  chunkMeta: completeChunkMeta,
  repoRoot,
  indexSignature: 'context-pack-evidence-test',
  includeGraph: false,
  includeTypes: false,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  depth: 0,
  maxTokens: 2
});

assert.equal(truncatedPack.evidence?.primary?.state, 'file-backed');
assert.equal(truncatedPack.evidence?.primary?.source, 'file-range');
assert.equal(truncatedPack.evidence?.primary?.truncated, true);
assert.equal(truncatedPack.evidence?.primary?.truncatedTokens, true);
assert.equal(truncatedPack.evidence?.complete, false);
assert.ok(
  truncatedPack.evidence?.primary?.warningCodes?.includes('PRIMARY_EXCERPT_TRUNCATED'),
  'expected truncation warning code on primary evidence'
);

const fallbackPack = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-fallback' },
  chunkMeta: [
    {
      chunkUid: 'chunk-fallback',
      start: 0,
      end: 20,
      startLine: 1,
      endLine: 1,
      headline: 'headline fallback excerpt'
    }
  ],
  repoRoot,
  indexSignature: 'context-pack-evidence-test',
  includeGraph: false,
  includeTypes: true,
  includeRisk: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  depth: 0
});

assert.equal(fallbackPack.evidence?.primary?.state, 'fallback');
assert.equal(fallbackPack.evidence?.primary?.source, 'headline-fallback');
assert.equal(fallbackPack.evidence?.primary?.substituted, true);
assert.equal(fallbackPack.evidence?.primary?.missing, false);
assert.equal(fallbackPack.evidence?.types?.state, 'missing');
assert.equal(fallbackPack.evidence?.complete, false);

const validation = validateCompositeContextPack(fallbackPack);
assert.equal(validation.ok, true, `expected fallback evidence pack to validate: ${validation.errors.join(', ')}`);

assert.throws(
  () => assembleCompositeContextPack({
    seed: { type: 'chunk', chunkUid: 'chunk-file' },
    chunkMeta: completeChunkMeta,
    repoRoot,
    indexSignature: 'context-pack-evidence-test',
    includeGraph: false,
    includeTypes: false,
    includeRisk: false,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false,
    depth: 0,
    maxTokens: 2,
    strictEvidence: true
  }),
  (err) => err?.code === 'ERR_CONTEXT_PACK_STRICT_EVIDENCE'
    && err?.evidence?.primary?.truncated === true
    && err?.evidence?.complete === false
);

console.log('context pack evidence fidelity test passed');
