#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'extracted-prose');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const commentText = 'extracted-prose sentinel phrase';
const swiftCommentText = 'swift extracted-prose sentinel phrase';
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

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--scm-provider', 'none', '--repo', repoRoot, '--mode', 'extracted-prose', '--stub-embeddings'],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('Extracted-prose test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--no-ann', '--json', commentText],
  { env, encoding: 'utf8' }
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

const swiftResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--no-ann', '--json', swiftCommentText],
  { env, encoding: 'utf8' }
);
if (swiftResult.status !== 0) {
  console.error('Extracted-prose Swift test failed: search error.');
  if (swiftResult.stderr) console.error(swiftResult.stderr.trim());
  process.exit(swiftResult.status ?? 1);
}
let swiftPayload;
try {
  swiftPayload = JSON.parse(swiftResult.stdout || '{}');
} catch {
  console.error('Extracted-prose Swift test failed: invalid JSON output.');
  if (swiftResult.stdout) console.error(swiftResult.stdout.trim());
  process.exit(1);
}
const swiftHits = Array.isArray(swiftPayload.extractedProse) ? swiftPayload.extractedProse : [];
const swiftMatched = swiftHits.some((hit) => hit?.file === 'src/sample.swift');
if (!swiftMatched) {
  console.error('Extracted-prose Swift test failed: expected Swift hit missing.');
  process.exit(1);
}

const mdResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--no-ann', '--json', mdCommentText],
  { env, encoding: 'utf8' }
);
if (mdResult.status !== 0) {
  console.error('Extracted-prose markdown test failed: search error.');
  if (mdResult.stderr) console.error(mdResult.stderr.trim());
  process.exit(mdResult.status ?? 1);
}
let mdPayload;
try {
  mdPayload = JSON.parse(mdResult.stdout || '{}');
} catch {
  console.error('Extracted-prose markdown test failed: invalid JSON output.');
  if (mdResult.stdout) console.error(mdResult.stdout.trim());
  process.exit(1);
}
const mdHits = Array.isArray(mdPayload.extractedProse) ? mdPayload.extractedProse : [];
const mdMatched = mdHits.some((hit) => hit?.file === 'docs/notes.md');
if (!mdMatched) {
  console.error('Extracted-prose markdown test failed: expected markdown comment hit missing.');
  process.exit(1);
}

const mdPlainResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--no-ann', '--json', mdPlainText],
  { env, encoding: 'utf8' }
);
if (mdPlainResult.status !== 0) {
  console.error('Extracted-prose markdown plain test failed: search error.');
  if (mdPlainResult.stderr) console.error(mdPlainResult.stderr.trim());
  process.exit(mdPlainResult.status ?? 1);
}
let mdPlainPayload;
try {
  mdPlainPayload = JSON.parse(mdPlainResult.stdout || '{}');
} catch {
  console.error('Extracted-prose markdown plain test failed: invalid JSON output.');
  if (mdPlainResult.stdout) console.error(mdPlainResult.stdout.trim());
  process.exit(1);
}
const mdPlainHits = Array.isArray(mdPlainPayload.extractedProse) ? mdPlainPayload.extractedProse : [];
if (mdPlainHits.length !== 0) {
  console.error('Extracted-prose markdown plain test failed: expected no hits.');
  process.exit(1);
}

console.log('Extracted-prose test passed.');

