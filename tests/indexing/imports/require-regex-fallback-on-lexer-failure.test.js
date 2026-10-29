#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';
import { collectImports } from '../../../src/lang/javascript/imports.js';
import { canReuseImportExtraction, getImportExtraction } from '../../../src/shared/import-extraction.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'imports-regex-fallback');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const filePath = path.join(srcRoot, 'broken.js');
const text = String.raw`// require('comment-ghost')
const note = "require('string-ghost')";
const lib = require('regex-dep');
req\u0075ire('escaped-dep');
const = ;
`;
await fs.writeFile(filePath, text);
const stat = await fs.stat(filePath);

const { importsByFile, importExtractionByFile } = await scanImports({
  files: [{ abs: filePath, rel: 'src/broken.js', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

const imports = importsByFile['src/broken.js'] || [];
assert.ok(imports.includes('regex-dep'), 'expected regex-dep import from regex fallback');
assert.deepEqual(imports, ['escaped-dep', 'regex-dep'], 'real tokenization preserves candidates without comment/string ghosts');
const receipt = importExtractionByFile['src/broken.js'];
assert.equal(receipt.state, 'invalid'); assert.equal(receipt.reasonCounts['parse-failed'], 1);
assert.equal(receipt.parser.id, 'acorn-tokenizer');
assert.equal(canReuseImportExtraction(receipt, imports), false, 'useful broken-file candidates never qualify a warm scan');
for (const [budget, reason] of [[{ maxChars: 4 }, 'source_bytes'], [{ maxTokens: 2 }, 'scan_tokens'],
  [{ maxMatches: 1 }, 'scan_matches'], [{ maxLines: 1 }, 'scan_lines']]) {
  const values = collectImports(text, { collectorScanBudget: budget });
  assert.ok(getImportExtraction(values).reasonCounts[reason]);
  assert.equal(canReuseImportExtraction(getImportExtraction(values), values), false);
}

console.log('Broken-source require candidates retain lexical and replay boundaries.');

