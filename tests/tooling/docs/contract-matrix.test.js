#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArtifactSchemaIndex } from '../../../src/contracts/artifact-schema-index.js';

const root = process.cwd();

{
  const guidePath = path.join(root, 'docs', 'guides', 'perfplan-execution.md');
  const text = await fsPromises.readFile(guidePath, 'utf8');
  assert.ok(text.includes('# PERFPLAN Execution Guide'));
  assert.ok(/ROADMAP\.md|roadmap/i.test(text));
  assert.ok(text.includes('docs/guides/roadmap-checklists.md'));
  assert.ok(text.includes('docs/guides/jsdoc-standards.md'));
}

{
  const docPath = path.join(root, 'docs', 'guides', 'jsdoc-standards.md');
  const text = await fsPromises.readFile(docPath, 'utf8');
  assert.ok(text.includes('# JSDoc Standards'));
  assert.ok(text.includes('## Required sections'));
  assert.ok(text.includes('Performance'));
  assert.ok(text.includes('## Examples'));
}

{
  const docPath = path.join(root, 'docs', 'specs', 'embeddings-cache.md');
  const text = await fsPromises.readFile(docPath, 'utf8');
  assert.ok(text.includes('# Embeddings Cache'));
  assert.ok(text.includes('## Layout'));
  assert.ok(/##\s+Cache entry format/i.test(text));
  assert.ok(text.includes('## Invalidation'));
  assert.ok(text.includes('## Pruning'));
  assert.ok(text.includes('## Configuration'));
}

{
  const requiredDocs = [
    'docs/specs/vfs-manifest-artifact.md',
    'docs/specs/vfs-index.md',
    'docs/specs/vfs-hash-routing.md',
    'docs/specs/vfs-token-uris.md',
    'docs/specs/vfs-io-batching.md',
    'docs/specs/vfs-segment-hash-cache.md',
    'docs/specs/vfs-cdc-segmentation.md',
    'docs/specs/vfs-cold-start-cache.md',
    'docs/specs/tooling-provider-registry.md',
    'docs/specs/tooling-vfs-and-segment-routing.md',
    'docs/specs/map-artifact.md',
    'docs/perf/map-pipeline.md'
  ];
  for (const rel of requiredDocs) {
    const abs = path.join(root, rel);
    await fsPromises.access(abs);
  }
}

{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const targetPath = path.join(path.resolve(__dirname, '../../..'), 'docs', 'contracts', 'artifact-schema-index.json');
  const expected = buildArtifactSchemaIndex();
  const raw = await fsPromises.readFile(targetPath, 'utf8');
  const actual = JSON.parse(raw);
  assert.deepStrictEqual(actual, expected);
}

{
  const tablePath = path.join(root, 'docs', 'testing', 'truth-table.md');
  const raw = fs.readFileSync(tablePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const claims = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('- Claim:')) {
      if (current) claims.push(current);
      current = { line: i + 1, lines: [line] };
      continue;
    }
    if (current) {
      if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        claims.push(current);
        current = null;
        continue;
      }
      current.lines.push(line);
    }
  }
  if (current) claims.push(current);
  assert.ok(claims.length > 0, 'Truth table validation failed: no claims found.');

  const requiredLabels = ['Implementation:', 'Config:', 'Tests:', 'Limitations:'];
  const issues = [];
  const findLabelLine = (blockLines, label) => blockLines.find((line) => line.includes(label)) || null;
  for (const claim of claims) {
    const blockText = claim.lines.join('\n');
    for (const label of requiredLabels) {
      const line = findLabelLine(claim.lines, label);
      if (!line) {
        issues.push(`Claim at line ${claim.line} missing ${label}`);
        continue;
      }
      const content = line.split(label)[1];
      if (!content || !content.trim()) {
        issues.push(`Claim at line ${claim.line} has empty ${label}`);
      }
    }
    const testsLine = findLabelLine(claim.lines, 'Tests:');
    if (testsLine && !/tests\//.test(testsLine)) {
      issues.push(`Claim at line ${claim.line} Tests line missing tests/ reference`);
    }
    if (!testsLine && /Tests:/.test(blockText)) {
      issues.push(`Claim at line ${claim.line} has malformed Tests line`);
    }
  }
  assert.deepEqual(issues, []);
}

{
  const contractPath = path.join(root, 'docs', 'config', 'contract.md');
  const text = await fsPromises.readFile(contractPath, 'utf8');
  assert.ok(text.includes('indexing.embeddings.cache.scope'));
  assert.ok(text.includes('tooling.vfs'));
}

console.log('tooling docs contract matrix test passed');
