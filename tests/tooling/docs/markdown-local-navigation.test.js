#!/usr/bin/env node
// Source UNVALIDATED; inert Markdown sources only, no recipe/network execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectMarkdownAnchors, extractMarkdownLinks, checkMarkdownDocuments } from '../../../tools/docs/markdown-links.js';

const extracted = extractMarkdownLinks('[nested [label]](target(1).md#heading "title")\n[reference][alias]\n[shortcut]\n[alias]: target%20file.md#one\n[shortcut]: target.md#two\n`[code](missing.md)`\n````md\n```\n[code](missing.md)\n````\n<a href="target.md#two">html</a>');
assert.deepEqual(extracted.links.map(link => link.target), ['target(1).md#heading', 'target%20file.md#one', 'target.md#two', 'target.md#two']);
assert.deepEqual(extracted.diagnostics, []);
const headings = collectMarkdownAnchors('# A `code` heading!\n## Same\n## Same\n## Same-1\nHeading two\n===\n<a id="manual-ID"></a>\n```md\n## Hidden\n```');
assert.ok(headings.anchors.has('a-code-heading'));
assert.ok(headings.anchors.has('same-1'));
assert.ok(headings.anchors.has('same-1-1'));
assert.ok(headings.anchors.has('heading-two'));
assert.ok(headings.anchors.has('manual-ID'));
assert.equal(headings.anchors.has('hidden'), false);

const parent = path.join(process.cwd(), '.tmp', 'tasks', 'markdown-local-navigation');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'case-'));
try {
  await fs.writeFile(path.join(root, 'target file.md'), '# Café\n## Duplicate\n## Duplicate\n<a id="manual-ID"></a>\n');
  await fs.writeFile(path.join(root, 'README.md'), '# Start\n[unicode](target%20file.md#caf%C3%A9)\n[repeat](target%20file.md#duplicate-1)\n[manual](target%20file.md#manual-ID)\n[external](https://example.test/no-network)\n');
  const accepted = checkMarkdownDocuments({ root, files: ['README.md'] });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.coverage.localFragmentsChecked, 3);
  assert.equal(accepted.coverage.remoteReachabilityEvaluated, 0);
  await fs.appendFile(path.join(root, 'README.md'), '[stale](target%20file.md#old)\n[bad](target%ZZ.md)\n[escape](../../private.md)\n[ref][missing]\n');
  const rejected = checkMarkdownDocuments({ root, files: ['README.md'] });
  for (const code of ['missing-markdown-anchor', 'invalid-percent-encoding', 'local-link-escapes-repository', 'unresolved-reference']) assert.ok(rejected.issues.some(issue => issue.code === code));
  assert.ok(rejected.issues.every(issue => Number.isInteger(issue.line) && issue.line > 0));
  await fs.writeFile(path.join(root, 'invalid.md'), Buffer.from([0xc3, 0x28]));
  assert.equal(checkMarkdownDocuments({ root, files: ['invalid.md'] }).issues[0].code, 'invalid-source-or-utf8');
  await fs.writeFile(path.join(root, 'suspect.md'), '# Text\nUnexpected \uFFFD replacement.\n');
  assert.ok(checkMarkdownDocuments({ root, files: ['suspect.md'] }).issues.some(issue => issue.code === 'suspect-text-encoding'));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Markdown local navigation source fixture completed.');
