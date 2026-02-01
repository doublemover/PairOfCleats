#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'comment-join');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const commentPhrase = 'sundial lattice cobalt meadow orbit';
const fnName = 'codeOnlySample';
const source = [
  `/** ${commentPhrase} */`,
  `export function ${fnName}() { return 1; }`,
  ''
].join('\n');
await fsPromises.writeFile(path.join(srcDir, 'sample.js'), source);

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = path.join(tempRoot, 'cache');
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'all', '--stub-embeddings'],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('comment join test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const searchCodeComment = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'code', '--no-ann', '--json', commentPhrase],
  { env, encoding: 'utf8' }
);
if (searchCodeComment.status !== 0) {
  console.error('comment join test failed: code search error.');
  if (searchCodeComment.stderr) console.error(searchCodeComment.stderr.trim());
  process.exit(searchCodeComment.status ?? 1);
}
let codeCommentPayload;
try {
  codeCommentPayload = JSON.parse(searchCodeComment.stdout || '{}');
} catch {
  console.error('comment join test failed: code search JSON parse error.');
  process.exit(1);
}
const codeCommentHits = Array.isArray(codeCommentPayload.code) ? codeCommentPayload.code : [];
if (codeCommentHits.length !== 0) {
  console.error('comment join test failed: comment phrase should not match code search.');
  process.exit(1);
}

const searchExtracted = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--json', commentPhrase],
  { env, encoding: 'utf8' }
);
if (searchExtracted.status !== 0) {
  console.error('comment join test failed: extracted-prose search error.');
  if (searchExtracted.stderr) console.error(searchExtracted.stderr.trim());
  process.exit(searchExtracted.status ?? 1);
}
let extractedPayload;
try {
  extractedPayload = JSON.parse(searchExtracted.stdout || '{}');
} catch {
  console.error('comment join test failed: extracted-prose JSON parse error.');
  process.exit(1);
}
const extractedHits = Array.isArray(extractedPayload.extractedProse) ? extractedPayload.extractedProse : [];
if (!extractedHits.some((hit) => hit?.file === 'src/sample.js')) {
  console.error('comment join test failed: expected extracted-prose hit missing.');
  process.exit(1);
}

const searchCodeFn = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'code', '--no-ann', '--json', fnName],
  { env, encoding: 'utf8' }
);
if (searchCodeFn.status !== 0) {
  console.error('comment join test failed: code search for function error.');
  if (searchCodeFn.stderr) console.error(searchCodeFn.stderr.trim());
  process.exit(searchCodeFn.status ?? 1);
}
let codeFnPayload;
try {
  codeFnPayload = JSON.parse(searchCodeFn.stdout || '{}');
} catch {
  console.error('comment join test failed: code search JSON parse error.');
  process.exit(1);
}
const codeHits = Array.isArray(codeFnPayload.code) ? codeFnPayload.code : [];
if (!codeHits.length) {
  console.error('comment join test failed: expected code hit missing.');
  process.exit(1);
}
const commentExcerpt = codeHits[0]?.docmeta?.commentExcerpt || '';
if (!commentExcerpt.includes(commentPhrase)) {
  console.error('comment join test failed: expected comment excerpt missing.');
  process.exit(1);
}

const searchCodeNoComments = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'code', '--no-comments', '--no-ann', '--json', fnName],
  { env, encoding: 'utf8' }
);
if (searchCodeNoComments.status !== 0) {
  console.error('comment join test failed: code search --no-comments error.');
  if (searchCodeNoComments.stderr) console.error(searchCodeNoComments.stderr.trim());
  process.exit(searchCodeNoComments.status ?? 1);
}
let codeNoCommentsPayload;
try {
  codeNoCommentsPayload = JSON.parse(searchCodeNoComments.stdout || '{}');
} catch {
  console.error('comment join test failed: --no-comments JSON parse error.');
  process.exit(1);
}
const codeNoCommentsHits = Array.isArray(codeNoCommentsPayload.code) ? codeNoCommentsPayload.code : [];
if (!codeNoCommentsHits.length) {
  console.error('comment join test failed: expected code hit missing for --no-comments.');
  process.exit(1);
}
if (codeNoCommentsHits[0]?.docmeta?.commentExcerpt) {
  console.error('comment join test failed: comment excerpt should be absent with --no-comments.');
  process.exit(1);
}

console.log('comment join test passed.');

