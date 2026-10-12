#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSourcePreview, highlightSourceLine, formatSourcePreview, sanitizeTerminalText } from '../../../src/retrieval/output/format/source.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { createSearchOutputOptions, createSearchOutputHitState, captureSearchOutputStdout } from '../helpers/search-output-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-source-preview-'));
try {
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  const source = 'export function ready(): boolean {\n  return true; // ready\n}\n';
  await fs.writeFile(path.join(repo, 'safe.ts'), source);
  const hit = { id: 0, file: 'safe.ts', name: 'ready', start: 0, end: source.length, startLine: 1, endLine: 3,
    kind: 'FunctionDeclaration', docmeta: { returns: 'boolean', signature: 'ready(): boolean' }, score: 0, scoreType: 'filter' };
  const preview = readSourcePreview(repo, hit);
  assert.equal(preview.lines[1], '  return true; // ready');
  assert.match(formatSourcePreview(preview, { styled: true }), /\x1b\[/);
  assert.match(formatSourcePreview(preview, { styled: false }), /1 \| export function ready/);
  assert.match(highlightSourceLine('return true;'), /\x1b\[38;5;129mreturn/);
  assert.equal(highlightSourceLine('return true;', { styled: false }), 'return true;');
  await fs.writeFile(path.join(root, 'outside.ts'), source);
  assert.equal(readSourcePreview(repo, { ...hit, file: '../outside.ts' }), null);
  await fs.symlink(path.join(root, 'outside.ts'), path.join(repo, 'escape.ts'));
  assert.equal(readSourcePreview(repo, { ...hit, file: 'escape.ts' }), null);
  await fs.writeFile(path.join(repo, 'large.ts'), 'x'.repeat(512 * 1024 + 1));
  assert.equal(readSourcePreview(repo, { ...hit, file: 'large.ts' }), null);
  assert.equal(readSourcePreview(repo, { ...hit, start: -1 }), null);
  assert.equal(readSourcePreview(repo, { ...hit, end: Infinity }), null);
  const malicious = '\x1b[2J\x1b]52;c;Y29weQ==\x07unsafe\x1b[31m\u202e\x00';
  assert.doesNotMatch(sanitizeTerminalText(malicious), /[\x1b\x00\u202e]/);
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const render = async ({ tty = true, plain = false, noColor = null } = {}) => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: tty });
    return withTemporaryEnv({ NO_COLOR: noColor, TERM: 'xterm-256color' }, () => captureSearchOutputStdout(() => {
      renderSearchOutput(createSearchOutputOptions({ emitOutput: true, jsonOutput: false, jsonCompact: false, explain: false,
        rootDir: repo, plain, color, rawQuery: malicious, queryTokens: [],
        ...createSearchOutputHitState({ codeHits: [{ ...hit, name: malicious, docmeta: { ...hit.docmeta, signature: malicious } }] }) }));
    }));
  };
  try {
    const styled = await render();
    assert.match(styled, /working-tree excerpt/);
    assert.match(styled, /\x1b\[38;5;129mexport/);
    assert.doesNotMatch(styled, /\x1b\[2J|\x1b\]52|\u202e|\x00/);
    for (const options of [{ tty: false }, { plain: true }, { noColor: '' }]) {
      const plain = await render(options);
      assert.doesNotMatch(plain, /\x1b/);
      assert.match(plain, /return true/);
    }
  } finally {
    if (ttyDescriptor) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
    else delete process.stdout.isTTY;
  }
  console.log('safe source preview and terminal style compatibility test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
