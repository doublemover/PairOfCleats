#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scriptPath = path.join(root, 'src', 'retrieval', 'cli', 'search-entry.js');
const source = fs.readFileSync(scriptPath, 'utf8');

const staticImportPattern = /from ['"]\.\.\/\.\.\/integrations\/core\/index\.js['"]/;
const dynamicImportPattern = /import\(['"]\.\.\/\.\.\/integrations\/core\/index\.js['"]\)/;

if (staticImportPattern.test(source)) {
  console.error('search lazy imports test failed: canonical search entry should not statically import core index.');
  process.exit(1);
}

if (!dynamicImportPattern.test(source)) {
  console.error('search lazy imports test failed: expected dynamic import of core index.');
  process.exit(1);
}

console.log('search lazy imports test passed');
