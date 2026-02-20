#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const dispatchPath = path.join(root, 'src', 'index', 'chunking', 'dispatch.js');
const htmlPath = path.join(root, 'src', 'lang', 'html.js');

const [dispatchSource, htmlSource] = await Promise.all([
  fs.readFile(dispatchPath, 'utf8'),
  fs.readFile(htmlPath, 'utf8')
]);

const missingOptionPatterns = [
  /\bbuildGoChunks\s*\(\s*text\s*\)/,
  /\bbuildJavaChunks\s*\(\s*text\s*\)/,
  /\bbuildCSharpChunks\s*\(\s*text\s*\)/,
  /\bbuildKotlinChunks\s*\(\s*text\s*\)/,
  /\bbuildHtmlChunks\s*\(\s*text\s*\)/,
  /\bbuildCssChunks\s*\(\s*text\s*\)/,
  /\bbuildRustChunks\s*\(\s*text\s*\)/,
  /\bbuildSwiftChunks\s*\(\s*text\s*\)/,
  /\bbuildTypeScriptChunks\s*\(\s*text\s*\)/,
  /\bbuildJsChunks\s*\(\s*text\s*\)/,
  /\bbuildSqlChunks\s*\(\s*text\s*\)/,
  /\bbuildCLikeChunks\s*\(\s*text\s*,\s*ext\s*\)/
];

for (const pattern of missingOptionPatterns) {
  assert.equal(
    pattern.test(dispatchSource),
    false,
    `dispatch option-aware builder missing options: ${pattern}`
  );
}

assert.equal(
  /\['sql',\s*\(text\)\s*=>\s*buildSqlChunks\(/.test(htmlSource),
  false,
  'html embedded sql chunker should accept and forward options'
);

assert.equal(
  /\['sql',\s*\(text,\s*options\)\s*=>\s*buildSqlChunks\(text,\s*\{\s*\.\.\.\(options\s*\|\|\s*\{\}\),\s*dialect:\s*'generic'\s*\}\)\],/.test(htmlSource),
  true,
  'html embedded sql chunker should merge options and enforce generic dialect'
);

console.log('dispatch/html chunk-builder options forwarding ok');
