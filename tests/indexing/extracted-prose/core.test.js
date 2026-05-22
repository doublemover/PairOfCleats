#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { inspectExtractedProseState } from '../../helpers/extracted-prose-fixture.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'extracted-prose');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const commentText = 'extracted prose sentinel phrase';
const swiftCommentText = 'swift extracted prose sentinel phrase';
const mdCommentText = 'markdown comment sentinel phrase';
const mdPlainText = 'opal zephyr raptor kinetic comet';
const source = [
  '/**',
  ` * ${commentText}`,
  ' */',
  'export function sample() { return 1; }',
  ''
].join('\n');
await fsPromises.writeFile(path.join(srcDir, 'sample.js'), source);

const swiftSource = [
  `/// ${swiftCommentText}`,
  'struct SwiftSample {',
  '  func greet() -> String { "hi" }',
  '}',
  ''
].join('\n');
await fsPromises.writeFile(path.join(srcDir, 'sample.swift'), swiftSource);

const docsDir = path.join(repoRoot, 'docs');
await fsPromises.mkdir(docsDir, { recursive: true });
await fsPromises.writeFile(
  path.join(docsDir, 'notes.md'),
  `# Notes\n\n<!-- ${mdCommentText} -->\n\nMore text.\n`
);
await fsPromises.writeFile(
  path.join(docsDir, 'plain.md'),
  `# Plain\n\n${mdPlainText}\n`
);

const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'stub'
});

const buildResult = runNode(
  [path.join(root, 'build_index.js'), '--scm-provider', 'none', '--repo', repoRoot, '--stage', 'stage2', '--mode', 'extracted-prose', '--stub-embeddings'],
  'extracted-prose build',
  root,
  env,
  { stdio: 'pipe', allowFailure: true }
);
if (buildResult.status !== 0) {
  console.error('Extracted-prose test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const searchResult = runNode(
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--no-ann', '--json', commentText],
  'extracted-prose JS search',
  root,
  env,
  { stdio: 'pipe', allowFailure: true }
);
if (searchResult.status !== 0) {
  console.error('Extracted-prose test failed: search error.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch (err) {
  console.error('Extracted-prose test failed: invalid JSON output.');
  if (searchResult.stdout) console.error(searchResult.stdout.trim());
  process.exit(1);
}

const hits = Array.isArray(payload.extractedProse) ? payload.extractedProse : [];
const matched = hits.some((hit) => hit?.file === 'src/sample.js');
if (!matched) {
  console.error('Extracted-prose test failed: expected hit missing.');
  process.exit(1);
}

const state = inspectExtractedProseState(repoRoot);
assert.ok(state.indexDir, 'expected extracted-prose index dir');
const chunks = await loadJsonArrayArtifact(state.indexDir, 'chunk_meta', { strict: true });
const textFor = (chunk) => [
  chunk?.headline,
  ...(Array.isArray(chunk?.docmeta?.comments)
    ? chunk.docmeta.comments.map((comment) => comment?.text)
    : [])
].filter(Boolean).join('\n');
const byFile = new Map(chunks.map((chunk) => [chunk?.file, chunk]));

assert.ok(textFor(byFile.get('src/sample.swift')).includes(swiftCommentText), 'expected Swift comment extraction');
assert.ok(textFor(byFile.get('docs/notes.md')).includes(mdCommentText), 'expected markdown comment extraction');
assert.equal(byFile.has('docs/plain.md'), false, 'expected markdown plain prose to stay out of extracted-prose chunks');

console.log('Extracted-prose test passed.');

