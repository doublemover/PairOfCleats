import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { prefetchFileRanges } from '../../src/context-pack/excerpt-cache.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-source-identity-'));
try {
  const file = path.join(root, 'source.js');
  const original = 'const value = 10;\n';
  fs.writeFileSync(file, original);
  const hash = createHash('sha1').update(original).digest('hex');
  const chunk = { chunkUid: 'source', file: 'source.js', start: 0, end: original.length,
    fileHash: hash, fileHashAlgo: 'sha1' };
  const read = () => assembleCompositeContextPack({
    seed: { type: 'chunk', chunkUid: 'source' }, chunkMeta: [chunk], repoRoot: root,
    indexSignature: 'pinned-generation', includeGraph: false, includeTypes: false,
    includeRisk: false, includeImports: false, includeUsages: false, includeCallersCallees: false
  });
  const first = read();
  assert.equal(first.primary.excerpt, original);
  assert.equal(first.evidence.complete, true);
  assert.equal(first.evidence.primary.sourceIdentity.drift, 'unchanged');
  prefetchFileRanges([{ filePath: file, start: 0, end: original.length }], 'pinned-generation', root);
  const stat = fs.statSync(file);
  fs.writeFileSync(file, 'const value = 20;\n');
  fs.utimesSync(file, stat.atime, stat.mtime);
  const warm = read();
  assert.equal(warm.primary.excerpt, 'const value = 20;\n');
  assert.equal(warm.evidence.primary.sourceIdentity.drift, 'changed');
  assert.equal(warm.evidence.complete, false);
  assert.ok(warm.warnings.some((warning) => warning.code === 'PRIMARY_SOURCE_DRIFT'));
  prefetchFileRanges([{ filePath: file, start: 0, end: original.length }], 'pinned-generation', root);
  assert.equal(read().primary.excerpt, warm.primary.excerpt);
  assert.equal(read().evidence.primary.sourceIdentity.drift, 'changed');
  const replacement = path.join(root, 'replacement.js');
  fs.writeFileSync(replacement, '\nconst value = 30;\n');
  fs.renameSync(replacement, file);
  const replaced = read();
  assert.equal(replaced.evidence.primary.sourceIdentity.drift, 'changed');
  assert.notEqual(replaced.primary.excerpt, warm.primary.excerpt);
  assert.equal(replaced.evidence.complete, false);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('mutable source context identity test passed');
