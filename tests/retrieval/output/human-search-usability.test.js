#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { wrapTerminalText } from '../../../src/retrieval/output/format/shared.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { createSearchOutputOptions, createSearchOutputHitState, captureSearchOutputStdout } from '../helpers/search-output-fixture.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv();
const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-readable-search-'));
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
try {
  const source = 'export function needle() {\n  return true;\n}\n';
  await fs.writeFile(path.join(repo, 'source.js'), source);
  const hits = [1, 2, 3].map((id) => ({ id, file: 'source.js', name: `needle${id}`, kind: 'Function',
    start: 0, end: source.length, startLine: 50, endLine: 52, score: 1 / id, scoreType: 'bm25' }));
  const before = structuredClone(hits);
  const render = async ({ tty = true, plain = false, noColor = null, term = 'xterm-256color', columns = '40', json = false } = {}) => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: tty });
    let payload;
    const text = await withTemporaryEnv({ NO_COLOR: noColor, TERM: term, COLUMNS: columns }, () =>
      captureSearchOutputStdout(() => {
        payload = renderSearchOutput(createSearchOutputOptions({ emitOutput: true, jsonOutput: json, jsonCompact: false,
          explain: false, plain, rootDir: repo, color, rawQuery: 'needle', queryTokens: ['needle'],
          ...createSearchOutputHitState({ codeHits: hits }) }));
      }));
    return { text, payload };
  };
  const normal = await render({ columns: '108' });
  assert.equal((normal.text.match(/working-tree excerpt/g) || []).length, 3, 'later code hits also get bounded context');
  assert.match(stripAnsi(normal.text), /current files at indexed offsets; edits may differ/);
  assert.match(stripAnsi(normal.text), /order ranked within each mode/);
  assert.match(stripAnsi(normal.text), /More: --explain scores/);
  assert.match(stripAnsi(normal.text), /source\.js:\[50-52\]/, 'indexed result locations remain unchanged');
  assert.match(stripAnsi(normal.text), /> 1 [│|] export function needle/, 'preview locations describe current text');
  assert.deepEqual(hits, before, 'human formatting must not mutate hits');
  assert.deepEqual(normal.payload.code, before, 'scores, ordering and result membership remain unchanged');

  for (const options of [{ plain: true }, { noColor: '' }, { term: 'dumb' }]) {
    const { text } = await render(options);
    assert.doesNotMatch(text, /\x1b/);
    assert.ok(text.split('\n').every((line) => line.length <= 40), 'narrow plain TTY lines must fit');
    assert.match(text, /needle/);
  }
  const pipe = await render({ tty: false, columns: '24' });
  assert.doesNotMatch(pipe.text, /\x1b|More:/);
  assert.match(pipe.text, /current files at indexed offsets; edits may differ/,
    'piped prose is not hard-wrapped to a guessed terminal width');
  const json = await render({ json: true, columns: '24', noColor: '' });
  assert.deepEqual(JSON.parse(json.text), json.payload);
  assert.deepEqual(json.payload, normal.payload, 'human-only refinements must not alter the response contract');
  assert.doesNotMatch(json.text, /working-tree excerpt|More:/);

  const cursor = `next --cursor ${'opaque'.repeat(30)}`;
  assert.equal(wrapTerminalText(cursor, 24), cursor, 'continuation tokens remain copyable');
  const unicode = wrapTerminalText('結果🙂'.repeat(20), 24);
  assert.equal(unicode.replace(/\n  /g, ''), '結果🙂'.repeat(20));
  assert.ok(unicode.split('\n').every((line) => Array.from(line.trim()).length <= 12));
  const combiningSpace = `${'a'.repeat(27)} \u0301b`;
  assert.equal(wrapTerminalText(combiningSpace, 28).replace(/\n  /g, ''), combiningSpace,
    'word wrapping must not break inside a space-plus-combining-mark grapheme');
  const malicious = '\x1b]52;c;Y29weQ==\x07bad\u202e';
  hits[1].name = malicious;
  const safe = await render({ plain: true });
  assert.doesNotMatch(safe.text, /\x1b|\u202e/);
  console.log('human search usability and output contract test passed');
} finally {
  if (ttyDescriptor) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
  else delete process.stdout.isTTY;
  await fs.rm(repo, { recursive: true, force: true });
}
