#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { estimateIndexBytes } from '../../../src/retrieval/cli/options.js';

const root = process.cwd();
const indexDir = path.join(root, '.testCache', 'options-estimate-index-bytes-artifact-variants');
await fs.rm(indexDir, { recursive: true, force: true });
await fs.mkdir(path.join(indexDir, 'chunk_meta.parts'), { recursive: true });

const write = async (relativePath, content) => {
  const target = path.join(indexDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  const stat = await fs.stat(target);
  return stat.size;
};

let expected = 0;
expected += await write('chunk_meta.json.gz', Buffer.from('gzip-json'));
expected += await write('chunk_meta.columnar.json', Buffer.from('columnar'));
expected += await write('chunk_meta.binary-columnar.meta.json', Buffer.from('binary-meta'));
expected += await write('token_postings.binary-columnar.meta.json', Buffer.from('postings-binary-meta'));
expected += await write(path.join('chunk_meta.parts', 'chunk_meta.part-0000.jsonl'), Buffer.from('{"id":1}\n'));

const actual = estimateIndexBytes(indexDir);
assert.equal(actual, expected, `expected estimateIndexBytes to include compressed/columnar artifacts (${expected}), got ${actual}`);

console.log('options estimateIndexBytes artifact variant test passed');
