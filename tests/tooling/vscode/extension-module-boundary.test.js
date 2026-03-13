#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionRoot = path.join(root, 'extensions', 'vscode');
const sourceFiles = fs.readdirSync(extensionRoot)
  .filter((name) => /\.(?:js|cjs)$/u.test(name))
  .map((name) => path.join(extensionRoot, name));

const importPattern = /require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]/gu;

for (const filePath of sourceFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  let match = null;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[1] || match[2];
    if (!specifier || !specifier.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const relative = path.relative(extensionRoot, resolved);
    const escapesRoot = relative === '' ? false : relative.startsWith('..');
    assert.equal(
      escapesRoot,
      false,
      `expected extension module import to stay within package root (${path.basename(filePath)} -> ${specifier})`
    );
  }
}

console.log('vscode extension module boundary test passed');
