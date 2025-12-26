#!/usr/bin/env node
import { mergeAppendOnly } from './mergeAppendOnly.js';

const [baseFile, targetFile] = process.argv.slice(2);
if (!baseFile || !targetFile) {
  console.error('usage: mergeSearchHistory.js <baseFile> <targetFile>');
  process.exit(1);
}

await mergeAppendOnly(baseFile, targetFile);
