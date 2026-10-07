#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { classifyGeneratedArtifactContentPrefix, classifyGeneratedArtifactPrefix } from '../../../src/shared/generated-artifact.js';

const hash = 'a'.repeat(40);
const cases = [
  ['tree-sitter-chunks', `custom/tr/tree-sitter-chunk_lk1_${hash}.json`],
  ['cross-file-inference', 'custom/cross-file-inference/output-cache.json'],
  ['import-resolution', 'custom/import-resolution-cache.json'],
  ['import-resolution-persist-failure', 'custom/import-resolution-cache.json.fail-open.json'],
  ['scm-file-meta', 'custom/scm/file-meta-v1.json'],
  ['lsp-requests', 'custom/lsp/request-cache-v1.json'],
  ['command-probe', `custom/command-probes/${hash}.json`],
  ['workspace-preflight', `custom/workspace-preflight/${hash}/cargo-check.json`],
  ['pyright-planner-health', `custom/pyright-planner/${hash}.json`],
  ['pyright-runtime-health', `custom/pyright-runtime/${hash}.json`],
  ['learned-auto-profile', 'custom/runtime/learned-auto-profile.json'],
  ['scheduler-autotune', 'custom/metrics/scheduler-autotune.json'],
  ['tree-sitter-adaptive-profile', 'custom/adaptive-rows-per-sec.json'],
  ['embeddings-autotune', 'custom/metrics/embeddings-autotune.json'],
  ['enrichment-state', 'custom/enrichment_state.json']
];
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-object-cache-discovery-'));
try {
  for (const [artifact, relativePath] of cases) {
    const prefix = JSON.stringify(withGeneratedCacheMetadata({ version: 1, entries: { 'authored.js': 'not an exclusion' } }, artifact));
    const output = path.join(root, relativePath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, prefix);
    assert.equal(classifyGeneratedArtifactPrefix({ relativePath, prefix })?.artifact, artifact);
    assert.equal(classifyGeneratedArtifactContentPrefix({ prefix })?.artifact, artifact,
      'renamed already-read payload must use the integrated classifier');
    assert.equal(classifyGeneratedArtifactPrefix({ relativePath, prefix: '{"authored":true}' }), null);
  }
  await fs.writeFile(path.join(root, 'custom', 'authored.js'), 'export const keepThis = 1;\n');
  await fs.writeFile(path.join(root, 'custom', 'request-cache-v1.json'), '{"legacyOrAuthored":true}');
  await fs.writeFile(path.join(root, 'custom', 'quoted.json'), JSON.stringify({ example: withGeneratedCacheMetadata({ rows: [] }, 'lsp-requests') }));
  const skippedFiles = [];
  const found = await discoverFiles({ root, mode: 'code', skippedFiles, maxFileBytes: null,
    ignoreMatcher: { ignores: () => false } });
  assert.deepEqual(found.map(entry => entry.rel.replace(/\\/g, '/')).sort(),
    ['custom/authored.js', 'custom/quoted.json', 'custom/request-cache-v1.json']);
  const omitted = skippedFiles.filter(entry => entry.reason === 'generated-artifact');
  assert.equal(omitted.length, cases.length, 'every registered family is reached through real discovery');
  assert.ok(omitted.every(entry => entry.artifactKind === 'object-cache' && entry.action === 'omit'));
  console.log('All 15 object-cache families are omitted by discovery; authored, legacy and quoted controls survive.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
