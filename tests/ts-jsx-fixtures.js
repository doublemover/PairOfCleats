#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildJsChunks } from '../src/lang/javascript.js';
import { buildTypeScriptChunks, collectTypeScriptImports } from '../src/lang/typescript.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages', 'src');

function readFixture(name) {
  const filePath = path.join(fixtureRoot, name);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing fixture file: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

const tsxText = readFixture('typescript_component.tsx');
const tsxChunks = buildTypeScriptChunks(tsxText) || [];
const tsxHasWidget = tsxChunks.some((chunk) => chunk.name === 'FancyWidget');
if (!tsxHasWidget) {
  console.error('Expected TypeScript TSX chunk for FancyWidget.');
  process.exit(1);
}

const mtsText = readFixture('typescript_imports.mts');
const mtsImports = collectTypeScriptImports(mtsText);
const expectedMts = ['lib-alpha', 'lib-beta', 'lib-gamma', 'lib-delta'];
for (const mod of expectedMts) {
  if (!mtsImports.includes(mod)) {
    console.error(`Missing TypeScript import (${mod}) in .mts parsing.`);
    process.exit(1);
  }
}

const ctsText = readFixture('typescript_commonjs.cts');
const ctsImports = collectTypeScriptImports(ctsText);
if (!ctsImports.includes('legacy-lib')) {
  console.error('Missing TypeScript import (legacy-lib) in .cts parsing.');
  process.exit(1);
}

const jsxText = readFixture('javascript_component.jsx');
const jsxChunks = buildJsChunks(jsxText) || [];
const jsxHasApp = jsxChunks.some((chunk) => chunk.name === 'App');
const jsxHasButton = jsxChunks.some((chunk) => chunk.name === 'Button');
if (!jsxHasApp || !jsxHasButton) {
  console.error('Expected JSX chunks for App and Button.');
  process.exit(1);
}

console.log('TS/JSX fixture parsing tests passed');
