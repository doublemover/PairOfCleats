#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { resolveExcerpt, prefetchFileRanges, clearContextPackCaches } from '../../src/context-pack/excerpt-cache.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-context-utf16-'));
const filePath = path.join(root, 'source.js');
try {
  for (const prefix of ['// ascii\n', '// café😀\n', '// 世界世界\r\n', '// e\u0301\n', '\uFEFF// before\n']) {
    const target = 'function target() { return "世界😀"; }';
    const text = prefix + target + '\n'; await fs.writeFile(filePath, text);
    const indexedHash = createHash('sha1').update(text).digest('hex');
    prefetchFileRanges([{ filePath, start: prefix.length, end: prefix.length + target.length }], 'same-generation', root);
    const input = { filePath, repoRoot: root, start: prefix.length, end: prefix.length + target.length,
      indexSignature: 'same-generation', indexedHash };
    const value = resolveExcerpt(input);
    assert.equal(value.excerpt, target);
    assert.equal(value.sourceIdentity.drift, 'unchanged');
    for (const maxBytes of [1, 2, 3, 4, 28, 29, 30, 31, 32]) {
      const bounded = resolveExcerpt({ ...input, maxBytes });
      assert.ok(Buffer.byteLength(bounded.excerpt) <= maxBytes);
      assert.ok(!bounded.excerpt.includes('\uFFFD'));
      assert.equal(target.startsWith(bounded.excerpt), true);
    }
    assert.throws(() => resolveExcerpt({ ...input, end: text.length + 1 }), /valid UTF-16 span/);
    const astral = text.indexOf('😀');
    assert.throws(() => resolveExcerpt({ ...input, start: astral + 1 }), /valid UTF-16 span/);
    await fs.writeFile(filePath, text.replace('target', 'edited'));
    assert.equal(resolveExcerpt(input).sourceIdentity.drift, 'changed');
  }
  await fs.writeFile(filePath, Buffer.from([0xFF, 0xFE]));
  assert.throws(() => resolveExcerpt({ filePath, repoRoot: root, start: 0, end: 1 }), /encoded data|encoding/i);
} finally { clearContextPackCaches(); await fs.rm(root, { recursive: true, force: true }); }
console.log('context UTF-16 source spans preserve exact verified UTF-8 excerpts');
