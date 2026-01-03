#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonArrayFile, writeJsonObjectFile } from '../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, 'tests', '.cache', 'json-stream');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const arrayPath = path.join(outDir, 'array.json');
const arrayInput = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' }
];
await writeJsonArrayFile(arrayPath, arrayInput);
const arrayParsed = JSON.parse(await fs.readFile(arrayPath, 'utf8'));
if (JSON.stringify(arrayParsed) !== JSON.stringify(arrayInput)) {
  console.error('json-stream array test failed: parsed output mismatch.');
  process.exit(1);
}

const objPath = path.join(outDir, 'object.json');
const fields = { model: 'test', dims: 2, scale: 1 };
const arrays = {
  vectors: [
    [1, 2],
    [3, 4]
  ],
  vocab: ['foo', 'bar']
};
await writeJsonObjectFile(objPath, { fields, arrays });
const objParsed = JSON.parse(await fs.readFile(objPath, 'utf8'));
if (objParsed.model !== fields.model || objParsed.dims !== fields.dims || objParsed.scale !== fields.scale) {
  console.error('json-stream object test failed: fields mismatch.');
  process.exit(1);
}
if (!Array.isArray(objParsed.vectors) || objParsed.vectors.length !== arrays.vectors.length) {
  console.error('json-stream object test failed: vectors mismatch.');
  process.exit(1);
}
if (!Array.isArray(objParsed.vocab) || objParsed.vocab.length !== arrays.vocab.length) {
  console.error('json-stream object test failed: vocab mismatch.');
  process.exit(1);
}

console.log('json-stream test passed');
